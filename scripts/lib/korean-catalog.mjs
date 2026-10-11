export function validateKoreanCatalog(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (!/^bsd-\d+$/.test(row.id) || ids.has(row.id) || typeof row.name !== "string" || !row.name.trim()
      || typeof row.name_ko !== "string" || row.name_ko !== row.name_ko.trim()
      || row.name_ko.length > 80 || !/[가-힣]/u.test(row.name_ko)) throw new Error("INVALID_KOREAN_CATALOG");
    if (row.source === "wikidata" && (!/^Q\d+$/.test(row.source_id) || !/^\d{4}-\d{2}-\d{2}$/.test(row.birth_date))) {
      throw new Error("UNVERIFIED_PUBLIC_NAME");
    }
    ids.add(row.id);
  }
  return rows;
}

/** Never infer identity from name alone, and never replace an existing override. */
export function planKoreanPlayers(catalog, players, existingNames) {
  validateKoreanCatalog(catalog);
  const byId = new Map(players.map(row => [row.id, row]));
  const existing = new Set(existingNames.map(row => row.player_id));
  const rows = [], rejected = [];
  let preserved = 0;
  for (const candidate of catalog) {
    const current = byId.get(candidate.id);
    if (!current || current.provider !== "bsd" || current.name !== candidate.name
      || (candidate.birth_date && current.birth_date !== candidate.birth_date)) {
      rejected.push({ id: candidate.id, reason: "identity_mismatch_or_missing" });
      continue;
    }
    if (existing.has(candidate.id)) { preserved++; continue; }
    rows.push({
      player_id: current.id, display_name: candidate.name_ko,
      aliases: [...new Set([current.name, ...(candidate.aliases ?? [])])].slice(0, 20),
      source: candidate.source === "wikidata" ? "wikidata" : "transliteration",
      source_id: candidate.source === "wikidata" ? candidate.source_id : null,
    });
  }
  return { rows, preserved, rejected };
}

export async function readAllNames(client, table, columns) {
  const rows = [];
  for (let start = 0; start < 20000; start += 500) {
    const result = await client.from(table).select(columns).order(table === "player_names" ? "player_id" : "id").range(start, start + 499);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error("MISSING_CATALOG_RESULT");
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
  throw new Error("CATALOG_LIMIT_REACHED");
}

/** Legacy-schema compatibility: ON CONFLICT DO NOTHING also protects edits made
 * after preflight. The new migration instead provides one atomic audited RPC. */
export async function insertMissingPlayerNames(client, rows) {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += 200) {
    const result = await client.from("player_names").upsert(rows.slice(start, start + 200), {
      onConflict: "player_id", ignoreDuplicates: true,
    }).select("player_id,display_name,source");
    if (result.error) throw result.error;
    const written = result.data ?? [];
    inserted += written.length;
    if (written.length) {
      const audit = await client.from("operation_audit").insert({
        actor: null, action: "catalog.korean_names",
        detail: { batch: "korean-catalog-2026-10-11", mode: "legacy-schema", players: written.length,
          changes: written.map(row => ({ kind: "player", id: row.player_id, before: null, after: row.display_name, source: row.source })) },
      });
      if (audit.error) throw audit.error;
    }
  }
  return inserted;
}
