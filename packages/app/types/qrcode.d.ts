// Just the corner of the qrcode API this app uses. The DefinitelyTyped
// package pulls in @types/node, which replaces enough of the DOM's global
// types (setTimeout's return, URLSearchParams' iterator) to break unrelated
// files in a web-only project.
declare module "qrcode" {
  export interface QRCodeToStringOptions {
    type?: "svg" | "utf8" | "terminal";
    margin?: number;
    width?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }

  export function toString(
    text: string,
    options?: QRCodeToStringOptions,
  ): Promise<string>;
}
