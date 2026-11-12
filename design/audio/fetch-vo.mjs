// Download generated lines into web/public/audio/vo/<id>.mp3 (trimmed of leading/trailing silence, loudness evened).
//   node design/audio/fetch-vo.mjs '{"0":"https://…mp3", "1": "…"}'   (indexes are positions in lines.mjs all())
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { all } from './lines.mjs';

const rows = all();
const dir = new URL('../../web/public/audio/vo/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const map = JSON.parse(process.argv[2]);
for (const [i, url] of Object.entries(map)) {
  const [id, who, text] = rows[Number(i)];
  const raw = `${dir}${id}.raw.mp3`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(raw, buf);
  // Trim silence at both ends, even out loudness, mono 64k: small files, steady level between speakers.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-17:TP=-1.5:LRA=11',
    '-ac', '1', '-ar', '44100', '-b:a', '64k', `${dir}${id}.mp3`]);
  unlinkSync(raw);
  console.log('✓', i, id, who, text.slice(0, 40));
}
