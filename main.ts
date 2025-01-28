import { FileServer } from "./pkg/mod.ts";

const fileServer = new FileServer({
    fsRoot: "./examples/spa"
})

export default fileServer
