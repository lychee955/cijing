import {expect, it} from "vitest";
import {signatureResult} from "../../src/main/updates/adapters/signature";

it("requires a valid Windows signature, exact full publisher identity and matching file path", () => {
    const file = "C:\\updates\\setup.exe",
        subject = "CN=Example, O=Example Company";
    const result = {Status: 0, Subject: subject, Path: file};
    expect(signatureResult([subject], file, result)).toBeNull();
    for (const patch of [{Status: 2}, {Status: "0"}, {Subject: "CN=Attacker"}, {Path: "C:\\other.exe"}])
        expect(signatureResult([subject], file, {...result, ...patch})).not.toBeNull();
    expect(signatureResult(["Example"], file, result)).not.toBeNull();
    expect(signatureResult([], file, result)).not.toBeNull();
    expect(signatureResult([subject], file, null)).not.toBeNull();
});
