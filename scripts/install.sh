#!/bin/sh
# webmux-node installer — detects OS/arch and downloads the correct binary.
# Usage: curl -sSL https://raw.githubusercontent.com/chareice/webmux/main/scripts/install.sh | sh

set -e

REPO="chareice/webmux"
BINARY="webmux-node"
INSTALL_DIR="${WEBMUX_INSTALL_DIR:-$HOME/.local/bin}"

main() {
    require_tmux
    detect_platform
    ensure_install_dir

    if [ -n "$1" ]; then
        VERSION="$1"
    else
        VERSION=$(get_latest_version)
    fi

    ARTIFACT="${BINARY}-${OS}-${ARCH}"
    URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARTIFACT}"

    echo "Installing ${BINARY} ${VERSION} (${OS}/${ARCH})..."
    download "${URL}" "${INSTALL_DIR}/${BINARY}"
    chmod +x "${INSTALL_DIR}/${BINARY}"

    echo ""
    echo "Installed ${BINARY} to ${INSTALL_DIR}/${BINARY}"

    if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
        echo ""
        echo "NOTE: ${INSTALL_DIR} is not in your PATH."
        echo "Add it with:"
        echo ""
        case "$(basename "${SHELL:-sh}")" in
            fish)
                echo "  fish_add_path ${INSTALL_DIR}"
                ;;
            zsh)
                echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc"
                ;;
            *)
                echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bashrc"
                ;;
        esac
    fi
}

require_tmux() {
    if command -v tmux >/dev/null 2>&1; then
        return
    fi
    cat <<'EOF' >&2
error: tmux is required by webmux but is not installed.

Please install tmux first:

  Debian / Ubuntu:  sudo apt install tmux
  macOS (Homebrew): brew install tmux
  Arch:             sudo pacman -S tmux

Then re-run this installer.
EOF
    exit 1
}

detect_platform() {
    OS_RAW=$(uname -s)
    ARCH_RAW=$(uname -m)

    case "$OS_RAW" in
        Linux)  OS="linux" ;;
        Darwin) OS="darwin" ;;
        *)
            echo "Error: unsupported OS: $OS_RAW" >&2
            exit 1
            ;;
    esac

    case "$ARCH_RAW" in
        x86_64|amd64)   ARCH="x64" ;;
        aarch64|arm64)   ARCH="arm64" ;;
        *)
            echo "Error: unsupported architecture: $ARCH_RAW" >&2
            exit 1
            ;;
    esac
}

get_latest_version() {
    # Pick the newest `vX.Y.Z` release, skipping `desktop-v*` which ships the
    # desktop app and does not contain node binaries.
    API_URL="https://api.github.com/repos/${REPO}/releases"
    if command -v curl >/dev/null 2>&1; then
        RESPONSE=$(curl -sSL "${API_URL}")
    elif command -v wget >/dev/null 2>&1; then
        RESPONSE=$(wget -qO- "${API_URL}")
    else
        echo "Error: curl or wget is required" >&2
        exit 1
    fi

    VERSION=$(echo "${RESPONSE}" \
        | grep -oE '"tag_name":[[:space:]]*"v[0-9]+\.[0-9]+\.[0-9]+"' \
        | sed -E 's/.*"(v[0-9]+\.[0-9]+\.[0-9]+)"/\1/' \
        | sort -V \
        | tail -n 1)

    if [ -z "${VERSION}" ]; then
        echo "Error: could not determine latest node release from ${API_URL}" >&2
        exit 1
    fi

    echo "${VERSION}"
}

download() {
    url="$1"
    dest="$2"

    if command -v curl >/dev/null 2>&1; then
        if ! curl -sSL --fail -o "$dest" "$url"; then
            explain_missing_artifact
        fi
    elif command -v wget >/dev/null 2>&1; then
        if ! wget -q -O "$dest" "$url"; then
            explain_missing_artifact
        fi
    else
        echo "Error: curl or wget is required" >&2
        exit 1
    fi
}

explain_missing_artifact() {
    echo "Error: latest release ${VERSION} does not include a binary for ${OS}/${ARCH} (${ARTIFACT})." >&2
    echo "Publish a newer tagged release for this platform and try again." >&2
    exit 1
}

ensure_install_dir() {
    if [ ! -d "$INSTALL_DIR" ]; then
        mkdir -p "$INSTALL_DIR"
    fi
}

main "$@"
