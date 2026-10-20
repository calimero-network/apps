import React from "react";
import { Composition } from "remotion";
import { DURATION, FPS, Promo } from "./Promo";

export const Root: React.FC = () => (
  <>
    <Composition id="promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
    <Composition id="promo-vertical" component={Promo} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
  </>
);
