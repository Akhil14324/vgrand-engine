"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Fenced code block with a copy button — ChatGPT-style. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, "");
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-lg border bg-muted/60">
      <button
        onClick={() => {
          void navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/code:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="overflow-x-auto p-3 pr-10 text-[12.5px] leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

/**
 * Renders assistant text as Markdown — headings, lists, tables, and fenced
 * code blocks. Uses prose (tailwind typography) for sane defaults.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words dark:prose-invert",
        "prose-p:my-1.5 prose-p:leading-relaxed prose-headings:mb-2 prose-headings:mt-4 first:prose-headings:mt-0",
        "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-a:text-primary prose-blockquote:border-l-muted-foreground/40",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className: cls, children, ...props }) => {
            // Block code renders inside <pre> (handled above); inline stays small.
            const isBlock = cls?.includes("language-");
            return isBlock ? (
              <code className={cls} {...props}>
                {children}
              </code>
            ) : (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
