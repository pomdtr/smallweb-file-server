import { FileServer } from "./pkg/mod.ts";

const fileServer = new FileServer({
    fsRoot: "./examples/static"
})

export default fileServer
