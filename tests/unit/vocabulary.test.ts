import {describe, expect, it, vi} from "vitest";
import {MaimemoClient} from "../../src/main/maimemo/client";
import {ClientError} from "../../src/main/maimemo/errors";
import {DictionaryError, type Dictionary} from "../../src/main/dictionary/uapi";
import {VocabularyService} from "../../src/main/services/vocabulary-service";

const credentials = {token: "dummy", profileId: "profile"};
function setup() {
    const client = new MaimemoClient(async () => {
        throw new Error("No network");
    });
    const lookup = vi.spyOn(client, "lookup");
    const definitions = vi.fn<Dictionary["lookup"]>();
    return {
        lookup,
        definitions,
        service: new VocabularyService(client, {lookup: definitions})
    };
}
describe("matched word definitions", () => {
    it("associates definitions with each matched id, preserving empty definitions", async () => {
        const {lookup, definitions, service} = setup();
        lookup.mockResolvedValue([
            {id: "v1", spelling: "apple"},
            {id: "v2", spelling: "Apple"}
        ]);
        definitions.mockResolvedValueOnce({interpretations: ["n. 苹果"]}).mockResolvedValueOnce({interpretations: []});
        expect(await service.lookup(credentials, "apple")).toEqual([
            {id: "v1", spelling: "apple", interpretations: ["n. 苹果"]},
            {id: "v2", spelling: "Apple", interpretations: []}
        ]);
        expect(definitions.mock.calls).toEqual([["apple"], ["Apple"]]);
        expect(service.get("profile", "v1").interpretations).toEqual(["n. 苹果"]);
    });
    it("keeps matches selectable if UAPI fails, but propagates invalid Maimemo credentials", async () => {
        const {lookup, definitions, service} = setup();
        lookup.mockResolvedValue([{id: "v1", spelling: "apple"}]);
        definitions.mockRejectedValue(new DictionaryError("UAPI 免费访问受限或额度不足，请稍后重试。"));
        expect((await service.lookup(credentials, "apple"))[0]).toMatchObject({
            id: "v1",
            interpretationError: expect.any(String)
        });
        expect(service.get("profile", "v1").id).toBe("v1");
        lookup.mockRejectedValue(new ClientError("AUTH"));
        await expect(service.lookup(credentials, "apple")).rejects.toMatchObject({
            code: "AUTH"
        });
    });
    it("keeps a Maimemo match when UAPI has no entry", async () => {
        const {lookup, definitions, service} = setup();
        lookup.mockResolvedValue([{id: "v-missing", spelling: "uapi-missing"}]);
        definitions.mockResolvedValue({interpretations: []});

        expect(await service.lookup(credentials, "uapi-missing")).toEqual([
            {id: "v-missing", spelling: "uapi-missing", interpretations: []}
        ]);
        expect(lookup).toHaveBeenCalledWith("dummy", "uapi-missing");
        expect(definitions).toHaveBeenCalledWith("uapi-missing");
        expect(service.get("profile", "v-missing")).toMatchObject({
            id: "v-missing",
            spelling: "uapi-missing"
        });
    });
    it("does not request definitions for no matches or credential validation", async () => {
        const {lookup, definitions, service} = setup();
        lookup.mockResolvedValue([]);
        expect(await service.lookup(credentials, "unknown")).toEqual([]);
        await service.validate(credentials);
        expect(definitions).not.toHaveBeenCalled();
    });
});
