import { FileServer } from "./pkg/mod.ts";

const fileServer = new FileServer({
    rootDir: "./examples",
})

export default fileServer
