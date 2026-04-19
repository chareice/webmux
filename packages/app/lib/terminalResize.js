function isFiniteColumn(value) {
    return Number.isFinite(value) && value >= 2;
}
function isFiniteRow(value) {
    return Number.isFinite(value) && value >= 1;
}
export function buildResizeMessage(dims) {
    if (!dims)
        return null;
    const cols = Math.floor(dims.cols);
    const rows = Math.floor(dims.rows);
    if (!isFiniteColumn(cols) || !isFiniteRow(rows)) {
        return null;
    }
    return {
        type: "resize",
        cols,
        rows,
    };
}
export function didGainControl(previous, next) {
    return !previous && next;
}
