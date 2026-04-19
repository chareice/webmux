function fillRandomBytes(buffer, cryptoLike) {
    if (cryptoLike?.getRandomValues) {
        return cryptoLike.getRandomValues(buffer);
    }
    for (let index = 0; index < buffer.length; index += 1) {
        buffer[index] = Math.floor(Math.random() * 256);
    }
    return buffer;
}
function randomHex(length, cryptoLike) {
    const bytes = fillRandomBytes(new Uint8Array(length), cryptoLike);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
export function generateDeviceId(cryptoLike = globalThis.crypto) {
    if (cryptoLike?.randomUUID) {
        return cryptoLike.randomUUID();
    }
    return `tc-${Date.now().toString(36)}-${randomHex(8, cryptoLike)}`;
}
