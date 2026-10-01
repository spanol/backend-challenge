FROM oven/bun:1.4.2 AS runtime
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig.json ./
COPY eslint.config.mjs bunfig.toml .prettierrc.json .prettierignore .editorconfig ./
COPY README.md ARCHITECTURE.md AGENTS.md CHALLENGE.md compose.yaml compose.subiu.yaml ./
COPY docs ./docs
COPY specs ./specs
COPY plans ./plans
COPY .github ./.github
COPY .vscode ./.vscode
RUN mkdir -p test-results coverage && chown bun:bun test-results coverage
USER bun
EXPOSE 3000
CMD ["bun", "src/main.ts"]
