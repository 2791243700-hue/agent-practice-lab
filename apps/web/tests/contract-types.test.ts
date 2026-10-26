import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("generated union discriminators match every JSON wire constant", () => {
  const contracts = new URL("../../../contracts/", import.meta.url);
  const api = JSON.parse(
    readFileSync(new URL("openapi.json", contracts), "utf8"),
  );
  const source = ts.createSourceFile(
    "types.d.ts",
    readFileSync(new URL("types.d.ts", contracts), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const components = source.statements.find(
    (node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) && node.name.text === "components",
  );
  assert(components);
  const property = (members: ts.NodeArray<ts.TypeElement>, name: string) => {
    const result = members.find(
      (node): node is ts.PropertySignature =>
        ts.isPropertySignature(node) && node.name.getText(source) === name,
    );
    assert(result?.type, `missing generated property ${name}`);
    return result.type;
  };
  const schemas = property(components.members, "schemas");
  assert(ts.isTypeLiteralNode(schemas));
  let checked = 0;
  for (const union of Object.values(api.components.schemas) as {
    discriminator?: { propertyName: string };
    oneOf?: { $ref: string }[];
  }[]) {
    if (!union.discriminator) continue;
    for (const member of union.oneOf ?? []) {
      const name = member.$ref.split("/").at(-1)!;
      const key: string = union.discriminator.propertyName;
      const expected: string =
        api.components.schemas[name].properties[key].const;
      const generated = property(schemas.members, name);
      assert(ts.isTypeLiteralNode(generated));
      const tag = property(generated.members, key);
      assert(ts.isLiteralTypeNode(tag) && ts.isStringLiteral(tag.literal));
      assert.equal(tag.literal.text, expected, `${name}.${key}`);
      checked++;
    }
  }
  assert.equal(checked, 24);
});
