import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift", import.meta.url);
const original = "guard milliseconds.isFinite, abs(milliseconds) <= maxJavaScriptDateMilliseconds else {";
const replacement = "guard milliseconds.isFinite, Swift.abs(milliseconds) <= maxJavaScriptDateMilliseconds else {";
const source = readFileSync(file, "utf8");

if (!source.includes(original) && !source.includes(replacement)) throw new Error("Unsupported ExpoModulesJSI date implementation.");
if (source.includes(original)) writeFileSync(file, source.replace(original, replacement));
