import * as assert from "assert";
import { computeJsdocParamPaddings } from "../../jsdoc";

suite("computeJsdocParamPaddings", () => {
  test("型幅が違う連続 @param 行で説明の開始列が揃う", () => {
    const placements = computeJsdocParamPaddings(
      [" * @param {number} count x", " * @param {string} s 説明"],
      4
    );
    // 名前開始は両行とも列19で揃い済み。説明は行0が25、行1が21 → 行1に+4
    assert.deepStrictEqual(placements, [
      { lineIndex: 1, character: 21, padding: 4 },
    ]);
  });

  test("型省略の @param が混在しても名前と説明の両列が揃う", () => {
    const placements = computeJsdocParamPaddings(
      [" * @param {number} count x", " * @param verylongname y"],
      4
    );
    // 行1: 名前開始10 → 19 へ +9。説明は行0が25、行1が 23+9=32 → 行0に+7
    assert.deepStrictEqual(placements, [
      { lineIndex: 1, character: 10, padding: 9 },
      { lineIndex: 0, character: 25, padding: 7 },
    ]);
  });

  test("オプショナル名 `[count=1]` を1つの名前トークンとして扱う", () => {
    const placements = computeJsdocParamPaddings(
      [" * @param {number} [count=1] d", " * @param {number} n d"],
      4
    );
    // 名前開始は揃い済み。説明は行0が29、行1が21 → 行1に+8
    assert.deepStrictEqual(placements, [
      { lineIndex: 1, character: 21, padding: 8 },
    ]);
  });

  test("@param 以外の JSDoc 行はグループを分断する", () => {
    const placements = computeJsdocParamPaddings(
      [
        " * @param {number} a d",
        " * @returns {number} r",
        " * @param {string} bbbb d",
      ],
      4
    );
    assert.deepStrictEqual(placements, []);
  });

  test("連続する @property 行が @param と同様に整列される", () => {
    const placements = computeJsdocParamPaddings(
      [" * @property {number} a d", " * @property {string} bbbb d"],
      4
    );
    // 名前開始は両行とも列22で揃い済み。説明は行0が24、行1が27 → 行0に+3
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 24, padding: 3 },
    ]);
  });

  test("@arg / @argument が @param と同様に整列される", () => {
    const placements = computeJsdocParamPaddings(
      [" * @arg {number} a d", " * @argument {string} bbbb d"],
      4
    );
    // 名前開始は行0が17、行1が22 → 行0に+5。説明は行0が19+5=24、行1が27 → 行0に+3
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 17, padding: 5 },
      { lineIndex: 0, character: 19, padding: 3 },
    ]);
  });

  test("@param 群の直後の @property 群も同一グループとして整列される", () => {
    const placements = computeJsdocParamPaddings(
      [" * @param {number} a d", " * @property {string} bbbb d"],
      4
    );
    // 名前開始は行0が19、行1が22 → 行0に+3。説明は行0が21+3=24、行1が27 → 行0に+3
    assert.deepStrictEqual(placements, [
      { lineIndex: 0, character: 19, padding: 3 },
      { lineIndex: 0, character: 21, padding: 3 },
    ]);
  });

  test("単独の @param 行はグループにならない", () => {
    const placements = computeJsdocParamPaddings(
      ["const x = 1;", " * @param {number} a d", "const y = 2;"],
      4
    );
    assert.deepStrictEqual(placements, []);
  });

  test("説明のない @param 行は名前列だけ揃える", () => {
    const placements = computeJsdocParamPaddings(
      [" * @param {number} count", " * @param {string} s 説明"],
      4
    );
    assert.deepStrictEqual(placements, []);
  });

  test("JSDoc ブロック外の通常コードは対象外", () => {
    const placements = computeJsdocParamPaddings(
      ["const a = 1;", "const bb = 2;"],
      4
    );
    assert.deepStrictEqual(placements, []);
  });
});
