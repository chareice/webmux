#!/bin/sh
# Build the tmux the desktop app ships, so a Mac with no Homebrew can be a
# hub. tmux is linked against a static libevent and a static utf8proc built
# here (utf8proc is what makes CJK and emoji the right width; macOS's own
# wcwidth is years behind) and the ncurses every macOS has in its SDK, so the
# result depends on nothing outside /usr/lib. Both architectures are built
# and glued into one universal binary.
#
#   scripts/build-tmux-sidecar.sh <out dir>
#
# writes <out dir>/tmux-universal-apple-darwin, plus the per-architecture
# names Tauri looks for in a non-universal build. macOS only; on Linux the
# distribution's tmux is the one to use, and the node says so when it is
# missing.
set -eu

TMUX_VERSION=3.5a
TMUX_SHA256=16216bd0877170dfcc64157085ba9013610b12b082548c7c9542cc0103198951
LIBEVENT_VERSION=2.1.12-stable
LIBEVENT_SHA256=92e6de1be9ec176428fd2367677e61ceffc2ee1cb119035037a27d346b0403bb
UTF8PROC_VERSION=2.9.0
UTF8PROC_SHA256=bd215d04313b5bc42c1abedbcb0a6574667e31acee1085543a232204e36384c4
MACOS_MIN=11.0

out="${1:?usage: build-tmux-sidecar.sh <out dir>}"
[ "$(uname -s)" = Darwin ] || { echo "error: the tmux sidecar is built on macOS only" >&2; exit 1; }
mkdir -p "$out"
out="$(cd "$out" && pwd)"

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${TMUX_SIDECAR_WORK:-$root/target/tmux-sidecar}"
mkdir -p "$work"
cd "$work"

fetch() {
    name="$1"; url="$2"; sha="$3"
    if [ ! -f "$name" ] || [ "$(shasum -a 256 "$name" | cut -d' ' -f1)" != "$sha" ]; then
        curl -fsSL -o "$name" "$url"
    fi
    actual="$(shasum -a 256 "$name" | cut -d' ' -f1)"
    [ "$actual" = "$sha" ] || { echo "error: $name: checksum $actual, expected $sha" >&2; exit 1; }
}

fetch "tmux-$TMUX_VERSION.tar.gz" \
    "https://github.com/tmux/tmux/releases/download/$TMUX_VERSION/tmux-$TMUX_VERSION.tar.gz" "$TMUX_SHA256"
fetch "libevent-$LIBEVENT_VERSION.tar.gz" \
    "https://github.com/libevent/libevent/releases/download/release-$LIBEVENT_VERSION/libevent-$LIBEVENT_VERSION.tar.gz" "$LIBEVENT_SHA256"
fetch "utf8proc-$UTF8PROC_VERSION.tar.gz" \
    "https://github.com/JuliaStrings/utf8proc/releases/download/v$UTF8PROC_VERSION/utf8proc-$UTF8PROC_VERSION.tar.gz" "$UTF8PROC_SHA256"

build_arch() {
    arch="$1"          # arm64 | x86_64
    triple="$2"        # aarch64-apple-darwin | x86_64-apple-darwin
    prefix="$work/prefix-$arch"
    flags="-arch $arch -mmacosx-version-min=$MACOS_MIN"
    if [ -x "$prefix/bin/tmux" ]; then
        echo "tmux for $arch is already built"
        return
    fi
    rm -rf "$prefix" "src-$arch"
    mkdir -p "src-$arch" "$prefix"

    # libevent, static, without OpenSSL: tmux needs libevent_core only.
    tar -xzf "libevent-$LIBEVENT_VERSION.tar.gz" -C "src-$arch"
    (
        cd "src-$arch/libevent-$LIBEVENT_VERSION"
        ./configure --host="$triple" --prefix="$prefix" \
            --disable-shared --enable-static --disable-openssl \
            --disable-samples --disable-libevent-regress --disable-debug-mode \
            CC=clang CFLAGS="$flags" LDFLAGS="$flags" >/dev/null
        make -j"$(sysctl -n hw.ncpu)" >/dev/null
        make install >/dev/null
    )

    # utf8proc, static only: with a dylib beside it the linker would take
    # that, and the sidecar would depend on a file the app does not ship.
    tar -xzf "utf8proc-$UTF8PROC_VERSION.tar.gz" -C "src-$arch"
    (
        cd "src-$arch/utf8proc-$UTF8PROC_VERSION"
        make CC=clang CFLAGS="$flags -O2" prefix="$prefix" libutf8proc.a libutf8proc.pc >/dev/null
        mkdir -p "$prefix/include" "$prefix/lib/pkgconfig"
        cp libutf8proc.a "$prefix/lib/"
        cp utf8proc.h "$prefix/include/"
        cp libutf8proc.pc "$prefix/lib/pkgconfig/"
    )

    # tmux, against those and the SDK's ncurses. configure asks pkg-config
    # for all three; ncurses is not there, so it falls back to -lncurses,
    # which the SDK provides as a stub for /usr/lib/libncurses.dylib.
    tar -xzf "tmux-$TMUX_VERSION.tar.gz" -C "src-$arch"
    (
        cd "src-$arch/tmux-$TMUX_VERSION"
        PKG_CONFIG_PATH="$prefix/lib/pkgconfig" \
        ./configure --host="$triple" --prefix="$prefix" --enable-utf8proc \
            CC=clang CFLAGS="$flags" LDFLAGS="$flags" >/dev/null
        make -j"$(sysctl -n hw.ncpu)" >/dev/null
        make install >/dev/null
    )
    strip "$prefix/bin/tmux"
}

build_arch arm64 aarch64-apple-darwin
build_arch x86_64 x86_64-apple-darwin

lipo -create "$work/prefix-arm64/bin/tmux" "$work/prefix-x86_64/bin/tmux" \
    -output "$out/tmux-universal-apple-darwin"
cp "$work/prefix-arm64/bin/tmux" "$out/tmux-aarch64-apple-darwin"
cp "$work/prefix-x86_64/bin/tmux" "$out/tmux-x86_64-apple-darwin"
chmod +x "$out"/tmux-*

# Nothing outside /usr/lib, or it is not a sidecar. Dependency lines are the
# indented ones; a universal binary also prints one "(architecture …):"
# header per slice, which is not a dependency.
if otool -L "$out/tmux-universal-apple-darwin" | grep -E '^[[:space:]]' | grep -v -E '^[[:space:]]+/usr/lib/' >/dev/null; then
    echo "error: the tmux sidecar links outside /usr/lib:" >&2
    otool -L "$out/tmux-universal-apple-darwin" >&2
    exit 1
fi
lipo -info "$out/tmux-universal-apple-darwin"
"$out/tmux-universal-apple-darwin" -V
