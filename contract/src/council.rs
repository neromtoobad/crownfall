//! Temples: each house's congregation is a Sputnik DAO. This contract keeps its elder role equal to the house's
//! top devotees (it is the DAO's keeper, allowed only to add and remove elders), pays it the council's share
//! of every trade, and carries out what the elders vote for: works, bounties, alms, pacts, envoys and bars.
use crate::*;
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::json;
use near_sdk::Gas;

const DAO_DEPOSIT: u128 = 6 * NEAR;

#[near]
impl World {
    /// Make the house's council DAO. The founder pays its storage (6 NEAR on the Sputnik v2 factory).
    #[payable]
    pub fn create_council(&mut self, house: u32) -> Promise {
        let g = self.house(house);
        require!(env::predecessor_account_id() == g.founder || env::predecessor_account_id() == self.owner, "only the founder");
        require!(g.council_dao.is_none(), "it has a council");
        require!(env::attached_deposit().as_yoctonear() >= DAO_DEPOSIT, "attach 6 NEAR for the DAO's storage");
        let slug: String = g.name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
        let name = format!("{}-{}-{}", slug.trim_matches('-'), house, env::current_account_id().as_str().split('.').next().unwrap_or("crownfall"));
        let me = env::current_account_id();
        let policy = json!({
            "roles": [
                {"name": "keeper", "kind": {"Group": [me]}, "permissions": [
                    "add_member_to_role:AddProposal", "add_member_to_role:VoteApprove",
                    "remove_member_from_role:AddProposal", "remove_member_from_role:VoteApprove"], "vote_policy": {}},
                {"name": "elders", "kind": {"Group": [g.founder]}, "permissions": [
                    "call:AddProposal", "call:VoteApprove", "call:VoteReject", "call:Finalize",
                    "transfer:AddProposal", "transfer:VoteApprove", "transfer:VoteReject", "transfer:Finalize",
                    "vote:AddProposal", "vote:VoteApprove", "vote:VoteReject"], "vote_policy": {}}
            ],
            "default_vote_policy": {"weight_kind": "RoleWeight", "quorum": "0", "threshold": [1, 2]},
            "proposal_bond": "0",
            "proposal_period": "86400000000000",
            "bounty_bond": "0",
            "bounty_forgiveness_period": "86400000000000"
        });
        let args = json!({
            "config": {"name": name, "purpose": format!("The council of {} in Crownfall. Elders are its top devotees, kept by {}.", g.name, me), "metadata": ""},
            "policy": policy
        });
        let dao: AccountId = format!("{}.{}", name, self.dao_factory).parse().expect("bad council name");
        Promise::new(self.dao_factory.clone())
            .function_call(
                "create".to_string(),
                json!({"name": name, "args": Base64VecU8(args.to_string().into_bytes())}).to_string().into_bytes(),
                env::attached_deposit(),
                Gas::from_tgas(150),
            )
            .then(Promise::new(me).function_call(
                "on_council".to_string(),
                json!({"house": house, "dao": dao, "payer": env::predecessor_account_id(), "paid": U128(env::attached_deposit().as_yoctonear())}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(15),
            ))
    }

    #[private]
    pub fn on_council(&mut self, house: u32, dao: AccountId, payer: AccountId, paid: U128) -> bool {
        let ok = matches!(env::promise_result_checked(0, 100), Ok(ref v) if v.as_slice() != b"false");
        if ok {
            let mut g = self.house(house);
            g.council_dao = Some(dao.clone());
            g.dao_elders = vec![g.founder.clone()];
            self.houses.replace(house, g);
            event("council", json!({"house": house, "dao": dao}));
        } else {
            Promise::new(payer).transfer(NearToken::from_yoctonear(paid.0)).detach();
        }
        ok
    }

    /// Bring the DAO's elder role in line with the house's elders: at most two changes per call. Anyone can call it.
    pub fn sync_elders(&mut self, house: u32) -> u32 {
        let g = self.house(house);
        let Some(dao) = g.council_dao.clone() else { return 0 };
        let want = self.elders_of(&g);
        let mut changes: Vec<(AccountId, bool)> = want.iter().filter(|a| !g.dao_elders.contains(a)).map(|a| (a.clone(), true)).collect();
        // Never empty the role: remove only when somebody else is (or will be) an elder.
        if !want.is_empty() {
            changes.extend(g.dao_elders.iter().filter(|a| !want.contains(a)).map(|a| (a.clone(), false)));
        }
        changes.truncate(2);
        for (who, add) in &changes {
            let kind = if *add {
                json!({"AddMemberToRole": {"member_id": who, "role": "elders"}})
            } else {
                json!({"RemoveMemberFromRole": {"member_id": who, "role": "elders"}})
            };
            let desc = format!("{} {} the elders of {} (by fealty).", if *add { "Seat" } else { "Unseat" }, who, g.name);
            Promise::new(dao.clone())
                .function_call("add_proposal".to_string(), json!({"proposal": {"description": desc, "kind": kind}}).to_string().into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(20))
                .then(Promise::new(env::current_account_id()).function_call(
                    "on_elder_proposal".to_string(),
                    json!({"house": house, "who": who, "add": add, "kind": kind}).to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(80),
                ))
                .detach();
        }
        changes.len() as u32
    }

    #[private]
    pub fn on_elder_proposal(&mut self, house: u32, who: AccountId, add: bool, kind: near_sdk::serde_json::Value) {
        let Ok(v) = env::promise_result_checked(0, 100) else { return };
        let Ok(id) = near_sdk::serde_json::from_slice::<u64>(&v) else { return };
        let mut g = self.house(house);
        let dao = g.council_dao.clone().unwrap();
        // The keeper is the only voter on elder changes, so its approval passes the proposal at once.
        Promise::new(dao)
            .function_call("act_proposal".to_string(), json!({"id": id, "action": "VoteApprove", "proposal": kind}).to_string().into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(50))
            .detach();
        if add {
            if !g.dao_elders.contains(&who) {
                g.dao_elders.push(who);
            }
        } else {
            g.dao_elders.retain(|a| a != &who);
        }
        self.houses.replace(house, g);
    }

    /// Send the council's share of trading and faded coins to its DAO. Anyone can call it.
    pub fn pay_council(&mut self, house: u32) -> U128 {
        let mut g = self.house(house);
        let dao = g.council_dao.clone().expect("no council yet");
        let due = g.council_due;
        require!(due > NEAR / 100, "less than 0.01 NEAR due");
        g.council_due = 0;
        self.houses.replace(house, g);
        Promise::new(dao).transfer(NearToken::from_yoctonear(due)).detach();
        event("tithe", json!({"house": house, "near": U128(due)}));
        U128(due)
    }

    // ---------- What the council's elders can vote for (called by the DAO) ----------

    /// Build a work for the folk. The NEAR goes to the age's offering pool.
    #[payable]
    pub fn build(&mut self, house: u32, work: Work) {
        let mut g = self.council_call(house);
        require!(!g.works.contains(&work), "already built");
        require!(env::attached_deposit().as_yoctonear() >= work.price(), "attach the work's price");
        g.works.push(work);
        self.pool += env::attached_deposit().as_yoctonear();
        self.houses.replace(house, g);
        event("build", json!({"house": house, "work": work}));
    }

    /// Put a bounty on a rival: every lightning or plague on it pays the caster `each`, from the attached NEAR.
    #[payable]
    pub fn set_bounty(&mut self, house: u32, target: u32, each: U128) {
        let mut g = self.council_call(house);
        require!(target != house && self.house(target).alive, "a living rival");
        require!(each.0 > 0, "a bounty per smite");
        if g.bounty_on != Some(target) {
            // Whatever is left of an old bounty stays in the pot for the new one.
            g.bounty_on = Some(target);
        }
        g.bounty_each = each.0;
        g.bounty_left += env::attached_deposit().as_yoctonear();
        self.houses.replace(house, g);
        event("bounty", json!({"house": house, "target": target, "each": each, "left": U128(self.house(house).bounty_left)}));
    }

    /// Give the attached NEAR to this age's devotees, by fealty. They claim it with `claim_alms`.
    #[payable]
    pub fn give_alms(&mut self, house: u32) {
        let mut g = self.council_call(house);
        require!(g.standing_total > 0, "no devotees yet this age");
        let gift = env::attached_deposit().as_yoctonear();
        g.alms_acc += mul_div(gift, COIN, g.standing_total);
        self.houses.replace(house, g);
        event("alms", json!({"house": house, "near": U128(gift)}));
    }

    /// Offer (or accept) a pact: neither house's people war on, or cast against, the other for `seasons`.
    pub fn offer_pact(&mut self, house: u32, other: u32, seasons: u32) -> bool {
        let mut g = self.council_call(house);
        require!(other != house && self.house(other).alive, "a living house");
        require!((1..=288).contains(&seasons), "1 to 288 seasons");
        let mut o = self.house(other);
        if let Some(at) = o.pact_offers.iter().position(|(x, s)| *x == house && *s == seasons) {
            o.pact_offers.remove(at);
            let until = self.gseason + seasons as u64;
            g.pacts.retain(|(x, _)| *x != other);
            o.pacts.retain(|(x, _)| *x != house);
            g.pacts.push((other, until));
            o.pacts.push((house, until));
            self.houses.replace(other, o);
            self.houses.replace(house, g);
            event("pact", json!({"houses": [house, other], "until": until}));
            true
        } else {
            g.pact_offers.retain(|(x, _)| *x != other);
            g.pact_offers.push((other, seasons));
            self.houses.replace(house, g);
            false
        }
    }

    /// Send envoys to a seat for 12 seasons (they work twice as hard there). 0.5 NEAR, to the pool.
    #[payable]
    pub fn send_envoys(&mut self, house: u32, seat: u8) {
        let mut g = self.council_call(house);
        require!((seat as usize) < SEATS && seat != g.seat, "another seat");
        require!(env::attached_deposit().as_yoctonear() >= NEAR / 2, "attach 0.5 NEAR");
        g.envoy = Some((seat, 12));
        self.pool += env::attached_deposit().as_yoctonear();
        self.houses.replace(house, g);
        event("envoys", json!({"house": house, "seat": seat}));
    }

    /// Bar an account from the elders for some seasons (the DAO's vote is the two-thirds check).
    pub fn bar_elder(&mut self, house: u32, account: AccountId, seasons: u32) {
        let mut g = self.council_call(house);
        let until = self.gseason + seasons.min(288) as u64;
        g.barred.retain(|(a, u)| a != &account && *u > self.gseason);
        g.barred.push((account.clone(), until));
        self.houses.replace(house, g);
        event("bar", json!({"house": house, "account": account, "until": until}));
    }

    // ---------- Devotees ----------

    pub fn claim_alms(&mut self, house: u32) -> U128 {
        let who = env::predecessor_account_id();
        let mut g = self.house(house);
        let mut h = self.settled(&mut g, &who);
        let owed = h.alms_owed;
        require!(owed > 0, "nothing owed");
        h.alms_owed = 0;
        self.holdings.insert((house, who.clone()), h);
        self.houses.replace(house, g);
        Promise::new(who).transfer(NearToken::from_yoctonear(owed)).detach();
        U128(owed)
    }

    /// An elder opens a rebellion: if elders holding a third of the elders' fealty back it within 12
    /// seasons and a seat is free, they leave with their coins to found `name`.
    pub fn start_rebellion(&mut self, house: u32, name: String) {
        let who = env::predecessor_account_id();
        let g = self.house(house);
        require!(g.alive, "this house has faded");
        require!(self.elders_of(&g).contains(&who), "only an elder");
        require!(!self.rebellions.iter().any(|s| s.house == house), "a rebellion is already open");
        let name = name.trim().to_string();
        require!(!name.is_empty() && name.chars().count() <= 24, "a name of 1 to 24 letters");
        self.rebellions.push(Rebellion { house, name: name.clone(), backers: vec![who.clone()], opened: self.gseason });
        event("rebellion_open", json!({"house": house, "name": name, "by": who}));
    }

    pub fn join_rebellion(&mut self, house: u32) {
        let who = env::predecessor_account_id();
        let g = self.house(house);
        require!(self.elders_of(&g).contains(&who), "only an elder");
        let s = self.rebellions.iter_mut().find(|s| s.house == house).expect("no rebellion open");
        if !s.backers.contains(&who) {
            s.backers.push(who.clone());
        }
        event("rebellion_join", json!({"house": house, "by": who}));
    }
}

impl World {
    fn council_call(&self, house: u32) -> House {
        let g = self.house(house);
        require!(g.alive, "this house has faded");
        require!(g.council_dao.as_ref() == Some(&env::predecessor_account_id()), "only the house's council");
        g
    }
}
