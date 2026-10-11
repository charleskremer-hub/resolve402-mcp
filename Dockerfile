# resolve402-mcp — stdio MCP server (used by directory checks such as Glama).
# Runs without a wallet: tools then return the price and setup instructions instead of paying.
# To pay per call, pass EVM_PRIVATE_KEY (Base) and/or SVM_PRIVATE_KEY (Solana) at run time; never bake keys into the image.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY index.js lib.js ./
USER node
ENTRYPOINT ["node", "index.js"]
