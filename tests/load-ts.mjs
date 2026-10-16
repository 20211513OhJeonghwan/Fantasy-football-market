import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
export function loadTs(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  if (diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:p=>p,getNewLine:()=>"\n"}));
  const loaded = { exports: {} };
  runInThisContext(`(function(require,module,exports){${outputText}\n})`)((id) => {
    if (!(id in dependencies)) throw new Error("Unexpected dependency " + id);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}
