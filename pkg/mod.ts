import * as http from "@std/http";
import * as path from "@std/path/posix";
import * as fs from "@std/fs";
import * as frontmatter from "@std/front-matter";
import * as html from "@std/html"
import { CSS } from "./styles.ts";

import { transpile } from "@deno/emit";

import { render, type RenderOptions } from "@deno/gfm";
import "prismjs/components/prism-bash.min.js";
import "prismjs/components/prism-javascript.min.js";
import "prismjs/components/prism-typescript.min.js";
import "prismjs/components/prism-css.min.js";
import "prismjs/components/prism-json.min.js";
import "prismjs/components/prism-jsx.min.js";
import "prismjs/components/prism-tsx.min.js";

const cache = await caches.open("file-server");

class FileServer {
    private serveDirOptions: http.ServeDirOptions = {
        showIndex: true,
        showDirListing: true,
        enableCors: true,
        showDotfiles: true,
        quiet: true,
    }

    private resolve(pathname: string) {
        if (this.serveDirOptions.urlRoot) {
            if (!pathname.startsWith(this.serveDirOptions.urlRoot)) {
                throw new Error("Invalid pathname");
            }

            pathname = pathname.replace(this.serveDirOptions.urlRoot, "");
        }

        return path.join(this.serveDirOptions.fsRoot || ".", pathname);
    }

    fetch: (req: Request) => Response | Promise<Response> = async (req) => {
        const url = new URL(req.url);

        const filepath = this.resolve(url.pathname);
        if (path.resolve(filepath) == path.resolve(".env")) {
            return new Response(".env files are not served", { status: 403 });
        }

        let info: Deno.FileInfo;
        try {
            info = await Deno.stat(filepath);
        } catch (_e) {
            const htmlInfo = await Deno.stat(filepath + ".html").catch(() => null);
            if (htmlInfo) {
                return http.serveDir(new Request(req.url + ".html", req), this.serveDirOptions);
            }

            const mdInfo = await Deno.stat(filepath + ".md").catch(() => null);
            if (mdInfo) {
                return this.serveMarkdown(new Request(req.url + ".md", req));
            }

            return new Response("Not found", { status: 404 });
        }

        if (info.isDirectory && !req.url.endsWith("/")) {
            return new Response(null, {
                status: 301,
                headers: {
                    location: req.url + "/",
                },
            });
        }

        if (
            info.isDirectory
            && this.serveDirOptions.showIndex
            && !await fs.exists(this.resolve(path.join(url.pathname, "index.html")))
            && await fs.exists(this.resolve(path.join(url.pathname, "index.md")))
        ) {
            return this.serveMarkdown(req);
        }

        const extension = path.extname(filepath);
        if (
            [".ts", ".tsx", ".jsx"].includes(extension)
        ) {
            return this.serveTranspiled(req);
        }

        if (extension === ".md") {
            return this.serveMarkdown(req);
        }

        return http.serveDir(req, this.serveDirOptions);
    };

    run: (args: string[]) => void | Promise<void> = async (args) => {
        const filepath = args.length > 0 ? this.resolve(args[0]) : this.serveDirOptions.fsRoot || ".";
        try {
            const stat = await Deno.stat(filepath);
            if (stat.isDirectory) {
                for await (const entry of Deno.readDir(filepath)) {
                    console.log(entry.name);
                }

                return;
            }
            const file = await Deno.open(filepath);
            file.readable.pipeTo(Deno.stdout.writable);

        } catch (e) {
            if (e instanceof Deno.errors.NotFound) {
                console.error(`File not found: ${filepath}`);
            } else {
                console.error(e);
            }

            Deno.exitCode = 1;
        }
    }


    private serveTranspiled = async (req: Request) => {
        const url = new URL(req.url);
        const filepath = this.resolve(url.pathname);
        const fileinfo = await Deno.stat(filepath)
            .catch(() => null);
        if (!fileinfo) {
            return new Response("Not found", { status: 404 }
            );
        }

        if (fileinfo.isDirectory) {
            return http.serveDir(req, this.serveDirOptions);
        }

        const cached = await cache.match(req);
        if (
            cached &&
            cached.headers.get("last-modified") ===
            fileinfo.mtime?.toUTCString()
        ) {
            return cached;
        }

        const script = await Deno.readTextFile(filepath);
        try {
            let contentType: string;
            switch (path.extname(url.pathname)) {
                case ".ts":
                    contentType = "text/typescript";
                    break;
                case ".tsx":
                    contentType = "text/tsx";
                    break;
                case ".jsx":
                    contentType = "text/jsx";
                    break;
                default:
                    throw new Error("Invalid extension");
            }

            const result = await transpile(url, {
                load: (url) => {
                    return Promise.resolve({
                        kind: "module",
                        specifier: url,
                        headers: {
                            "content-type": contentType,
                        },
                        content: script,
                    });
                },
            });
            const code = result.get(url.href);

            const res = new Response(code, {
                headers: {
                    "Content-Type": "text/javascript",
                    "last-modified": fileinfo.mtime?.toUTCString() || "",
                },
                status: 200,
            });

            if (this.serveDirOptions.enableCors) {
                res.headers.set("Access-Control-Allow-Origin", "*");
            }

            await cache.put(req, res.clone());
            return res;
        } catch (e) {
            console.error("Error transforming", e);
            return new Response(script, {
                status: 500,
                headers: {
                    "Content-Type": "text/javascript",
                },
            });
        }

    }

    private serveMarkdown = async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        const filepath = this.resolve(url.pathname);
        const fileinfo = await Deno.stat(filepath).catch(() => null);
        if (!fileinfo) {
            return new Response("Not found", { status: 404 });
        }

        if (fileinfo.isDirectory) {
            const index = path.join(this.serveDirOptions.fsRoot || ".", url.pathname, "index.md");
            if (!await fs.exists(index)) {
                return http.serveDir(req, this.serveDirOptions);
            }

            return this.serveMarkdown(new Request(`${url.origin}${path.join(url.pathname, "index.md")}`));
        }

        const cached = await cache.match(req);
        if (
            cached &&
            cached.headers.get("last-modified") ===
            fileinfo.mtime?.toUTCString()
        ) {
            return cached;
        }

        let markdown = await Deno.readTextFile(filepath);
        let attributes: { title?: string, description?: string, favicon?: string, renderOptions?: RenderOptions, head?: { tag: string, attrs: Record<string, unknown> }[] } = {}
        if (frontmatter.test(markdown, ["yaml"])) {
            const match = markdown.match(FRONTMATTER_REGEX);
            if (match) {
                const { attrs } = frontmatter.extractYaml<Omit<RenderOptions, "renderer"> & { title?: string }>(markdown);
                attributes = attrs;
                markdown = markdown.slice(match[0].length);
            }
        }

        const main = render(markdown, attributes.renderOptions);
        const head = attributes.head?.map(({ tag, attrs }) => {
            const safeAttrs = Object.entries(attrs).map(([key, value]) => `${html.escape(key)}="${html.escape(String(value))}"`).join(" ");
            return `<${html.escape(tag)} ${safeAttrs}></${html.escape(tag)}>`;
        }) || [];
        const body = layout({
            title: attributes.title || path.basename(filepath),
            description: attributes.description,
            favicon: attributes.favicon,
            head,
            body: main
        });
        const res = new Response(body, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "last-modified": fileinfo.mtime?.toUTCString() || "",
            },
        });

        if (this.serveDirOptions.enableCors) {
            res.headers.set("Access-Control-Allow-Origin", "*");
        }

        await cache.put(req, res.clone());
        return res;
    }
}

const FRONTMATTER_REGEX = /^---\n[\s\S]+?\n---\n/;


const layout = (params: {
    title: string;
    description?: string;
    favicon?: string;
    head: string[];
    body: string;
}) =>
    /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${html.escape(params.title)}</title>
${params.description ? `<meta name="description" content="${html.escape(params.description)}">` : ""}
${params.favicon ? `<link rel="icon" href="${html.escape(params.favicon)}">` : ""}
${params.head.join("\n")}
<style>
  main {
    max-width: 800px;
    margin: 0 auto;
  }
  ${CSS}
</style>
<script type="module" src=""></script>
</head>
<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark" class="markdown-body">
<main>
  ${params.body}
</main>
</body>
</html>
`;

const fileServer: FileServer = new FileServer();

export default fileServer;
