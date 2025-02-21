import { FileServer } from "./pkg/mod.ts";

const fileServer = new FileServer({
  fsRoot: "./examples/markdown",
});

export default fileServer;
