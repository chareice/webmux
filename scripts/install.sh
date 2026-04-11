#!/bin/sh
# webmux-node installer — detects OS/arch and downloads the correct binary.
# Usage: curl -sSL https://raw.githubusercontent.com/chareice/webmux/main/scripts/install.sh | sh

set -e

REPO="chareice/webmux"
BINARY="webmux-node"
INSTALL_DIR="${WEBMUX_INSTALL_DIR:-$HOME/.local/bin}"

main() {
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
    if command -v curl >/dev/null 2>&1; then
        curl -sSL -o /dev/null -w '%{url_effective}' \
            "https://github.com/${REPO}/releases/latest" \
            | rev | cut -d'/' -f1 | rev
    elif command -v wget >/dev/null 2>&1; then
        wget --spider --max-redirect=0 \
            "https://github.com/${REPO}/releases/latest" 2>&1 \
            | grep -i 'Location:' | sed 's/.*\///' | tr -d '\r'
    else
        echo "Error: curl or wget is required" >&2
        exit 1
    fi
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
