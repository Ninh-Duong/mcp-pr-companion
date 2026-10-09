# Reproducible runtime for mcp-pr-companion.
# Build:  docker build -t mcp-pr-companion .
# Run:    docker run --rm -i  --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion            (MCP server, stdio)
#         docker run --rm -it --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion cmd        (terminal UI)
#         docker run --rm     --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion generate-all
# Credentials are passed at run time via --env-file and are never baked into the image.
FROM node:22-slim

WORKDIR /app
COPY . .

# npm ci + tsc + stamps, so the bootstrap is a no-op when the container starts.
RUN node bin/cli.js prepare

VOLUME ["/app/ai-context", "/app/Logs"]
ENTRYPOINT ["node", "bin/cli.js"]
CMD ["server"]
