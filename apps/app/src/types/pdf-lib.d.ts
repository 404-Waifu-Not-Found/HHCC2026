declare module "pdf-lib/dist/pdf-lib.esm.js" {
  export * from "pdf-lib";
}

declare module "*.ttf" {
  const asset: number;
  export default asset;
}

declare module "*.png" {
  const asset: number;
  export default asset;
}
