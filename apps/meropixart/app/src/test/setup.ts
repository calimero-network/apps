import "@testing-library/jest-dom";
import { installCanvasStub } from "./canvasStub";

// jsdom has no 2D canvas. Everything pixel-shaped in this app (compositor,
// raster helpers, showcase renderer) would otherwise be untestable outside a
// browser — see ./canvasStub for what the stub does and, importantly, does not do.
installCanvasStub();
