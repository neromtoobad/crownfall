// The realm's grade: AO, bloom, ACES, colour and SMAA. Loaded on its own, and only on desktop.
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { usePlay } from './play.ts';

/** One grade over everything, so generated buildings, hand-made props and rigged people read as one world.
 * Contact shadows (AO) where walls meet the ground, a whisper of bloom on the sun and gold, ACES, a little
 * contrast, a touch less saturation, a soft vignette, then SMAA. Each is subtle enough to need a toggle to notice. */
export default function PostFX() {
  const mode = usePlay().mode;
  if (new URLSearchParams(location.search).has('nofx')) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {mode === 'play' ? <N8AO aoRadius={3.2} distanceFalloff={1.2} intensity={2.4} quality="medium" halfRes color="#1c2230" /> : <></>}
      <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.15} intensity={0.32} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={-0.06} />
      <BrightnessContrast contrast={0.07} brightness={0.01} />
      <Vignette offset={0.32} darkness={0.42} />
      <SMAA />
    </EffectComposer>
  );
}
