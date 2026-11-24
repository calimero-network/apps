import { Composition } from "remotion";
import { DURATION, FPS, Promo } from "./Promo";

export const Root = () => (
  <>
    <Composition id="promo" component={Promo} durationInFrames={DURATION * FPS} fps={FPS} width={1920} height={1080} defaultProps={{ vertical: false }} />
    <Composition id="promo-vertical" component={Promo} durationInFrames={DURATION * FPS} fps={FPS} width={1080} height={1920} defaultProps={{ vertical: true }} />
  </>
);
