FROM node:24-alpine

ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_BASE_URL=https://github.com/gitleaks/gitleaks/releases/download
ARG TARGETARCH

RUN apk add --no-cache git tar curl docker-cli \
 && case "${TARGETARCH:-amd64}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; esac \
 && curl -fsSL "${GITLEAKS_BASE_URL}/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz" | tar -xz -C /usr/local/bin gitleaks \
 && gitleaks version

WORKDIR /app
COPY package.json allowlist.json ./
COPY bin ./bin
COPY src ./src
COPY scripts ./scripts
COPY deploy/run-loop.sh ./deploy/run-loop.sh

ENTRYPOINT ["sh", "/app/deploy/run-loop.sh"]
