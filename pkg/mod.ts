import * as http from "@std/http";
import * as path from "@std/path/posix";
import * as fs from "@std/fs";
import * as frontmatter from "@std/front-matter";
import * as html from "@std/html";
import CSS from "./styles.ts";
import { parseAllRedirects } from "netlify-redirect-parser";

import { render, type RenderOptions } from "@deno/gfm";
import "prismjs/components/prism-bash.min.js";
import "prismjs/components/prism-javascript.min.js";
import "prismjs/components/prism-typescript.min.js";
import "prismjs/components/prism-css.min.js";
import "prismjs/components/prism-json.min.js";
import "prismjs/components/prism-jsx.min.js";
import "prismjs/components/prism-tsx.min.js";

export type FileServerOptions = {
  fsRoot?: string;
};

export class FileServer {
  private fsRoot: string;
  private cache: Promise<Cache> | null = null;

  constructor(opts?: FileServerOptions) {
    this.fsRoot = opts?.fsRoot || ".";
  }

  get serveDirOptions(): http.ServeDirOptions {
    return {
      showIndex: true,
      enableCors: true,
      showDotfiles: true,
      quiet: true,
      fsRoot: this.fsRoot,
    };
  }

  private resolve(pathname: string) {
    if (this.serveDirOptions.urlRoot) {
      if (!pathname.startsWith(this.serveDirOptions.urlRoot)) {
        throw new Error("Invalid pathname");
      }

      pathname = pathname.replace(this.serveDirOptions.urlRoot, "");
    }

    return path.join(this.fsRoot, pathname);
  }

  private async handleRedirects(
    url: URL,
    req: Request,
  ): Promise<Response | null> {
    const redirectsPath = await this.resolve("_redirects");
    const { errors, redirects } = await parseAllRedirects({
      redirectsFiles: [redirectsPath],
      configRedirects: [],
      minimal: false,
    }) as {
      errors: unknown[];
      redirects: { from: string; to: string; status?: number }[];
    };

    if (errors.length == 0) {
      for (const redirect of redirects) {
        if (redirect.from.endsWith("/*")) {
          redirect.from += "*";
        }

        const regexp = path.globToRegExp(redirect.from, {});
        if (!regexp.test(url.pathname)) {
          continue;
        }

        if (redirect.status == 200) {
          return http.serveDir(
            new Request(new URL(redirect.to, url.origin), req),
            this.serveDirOptions,
          );
        }

        return new Response(null, {
          status: redirect.status || 301,
          headers: {
            location: redirect.to,
          },
        });
      }
    }

    return null;
  }

  private getCache = async () => {
    if (!this.cache) {
      this.cache = caches.open("file-server");
    }

    return await this.cache;
  };

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
        return http.serveDir(
          new Request(req.url + ".html", req),
          this.serveDirOptions,
        );
      }

      const mdInfo = await Deno.stat(filepath + ".md").catch(() => null);
      if (mdInfo) {
        return this.serveMarkdown(new Request(req.url + ".md", req));
      }

      const redirectResponse = await this.handleRedirects(url, req);
      if (redirectResponse) {
        return redirectResponse;
      }

      // check for 404 page
      const notFoundHtmlInfo = await Deno.stat(this.resolve("404.html")).catch(
        () => null,
      );
      if (notFoundHtmlInfo) {
        const resp = await http.serveDir(
          new Request(new URL("404.html", url.origin), req),
          this.serveDirOptions,
        );
        return new Response(resp.body, {
          ...resp,
          status: 404,
        });
      }

      const notFoundMdInfo = await Deno.stat(this.resolve("404.md")).catch(() =>
        null
      );
      if (notFoundMdInfo) {
        return this.serveMarkdown(
          new Request(new URL("404.md", url.origin).toString()),
        );
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

    if (info.isDirectory) {
      if (
        await fs.exists(this.resolve(path.join(url.pathname, "index.html")))
      ) {
        return http.serveDir(req, this.serveDirOptions);
      }

      if (await fs.exists(this.resolve(path.join(url.pathname, "index.md")))) {
        return this.serveMarkdown(req);
      }

      const redirectResponse = await this.handleRedirects(url, req);
      if (redirectResponse) {
        return redirectResponse;
      }

      if (await fs.exists(this.resolve("404.html"))) {
        const resp = await http.serveDir(
          new Request(new URL("404.html", url.origin), req),
          this.serveDirOptions,
        );
        return new Response(resp.body, {
          ...resp,
          status: 404,
        });
      }

      return new Response("Not found", { status: 404 });
    }

    if (path.extname(filepath) === ".md") {
      return this.serveMarkdown(req);
    }

    return http.serveDir(req, this.serveDirOptions);
  };

  run: (args: string[]) => void | Promise<void> = async (args) => {
    const filepath = args.length > 0
      ? this.resolve(args[0])
      : this.serveDirOptions.fsRoot || ".";
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
  };

  private serveMarkdown = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const filepath = this.resolve(url.pathname);
    const fileinfo = await Deno.stat(filepath).catch(() => null);
    if (!fileinfo) {
      return new Response("Not found", { status: 404 });
    }

    if (fileinfo.isDirectory) {
      const index = this.resolve(path.join(url.pathname, "index.md"));
      if (!await fs.exists(index)) {
        return http.serveDir(req, this.serveDirOptions);
      }

      return this.serveMarkdown(
        new Request(`${url.origin}${path.join(url.pathname, "index.md")}`),
      );
    }

    const cache = await this.getCache();
    const cached = await cache.match(req);
    if (
      cached &&
      cached.headers.get("last-modified") ===
        fileinfo.mtime?.toUTCString()
    ) {
      return cached;
    }

    let markdown = await Deno.readTextFile(filepath);
    let attributes: {
      title?: string;
      description?: string;
      favicon?: string;
      renderOptions?: RenderOptions;
      head?: { tag: string; attrs?: Record<string, unknown> }[];
    } = {};
    if (frontmatter.test(markdown, ["yaml"])) {
      const { attrs, body } = frontmatter.extractYaml<
        Omit<RenderOptions, "renderer"> & { title?: string }
      >(markdown);
      attributes = attrs;
      markdown = body;
    }

    const main = render(markdown, attributes.renderOptions);
    const head = attributes.head?.map(({ tag, attrs }) => {
      const safeAttrs = Object.entries(attrs || {}).map(([key, value]) =>
        `${html.escape(key)}="${html.escape(String(value))}"`
      ).join(" ");
      return `<${html.escape(tag)} ${safeAttrs}></${html.escape(tag)}>`;
    }) || [];
    const body = layout({
      title: attributes.title || path.basename(filepath),
      description: attributes.description,
      favicon: attributes.favicon,
      head,
      body: main,
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
  };
}

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
    ${
    params.description
      ? `<meta name="description" content="${html.escape(params.description)}">`
      : ""
  }
    ${
    params.favicon
      ? `<link rel="icon" href="${html.escape(params.favicon)}">`
      : ""
  }
    ${params.head.join("\n")}
    <style>
        :root {
            color-scheme: light;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                color-scheme: dark;
            }
        }
        main {
            max-width: 800px;
            margin: 0 auto;
            padding: 0 1rem;
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
