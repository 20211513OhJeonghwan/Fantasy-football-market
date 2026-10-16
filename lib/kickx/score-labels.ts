/** Presentation-only wording for stored Performance results. Scores themselves always come from the server. */
export const METRIC_LABELS: Record<string, string> = {
  minutes: "출전",
  goals: "득점",
  assists: "도움",
  yellow_cards: "경고",
  red_cards: "퇴장",
  own_goals: "자책골",
  shots_on_target: "유효 슈팅",
  key_passes: "키패스",
  crosses_completed: "성공 크로스",
  pass_accuracy: "패스 성공률 보너스",
  tackles_won: "성공 태클",
  interceptions: "가로채기",
  team_win: "팀 승리",
  defensive_actions: "태클·가로채기",
  clean_sheet: "무실점",
  conceded: "실점",
  saves: "선방",
  penalty_saves: "페널티킥 선방",
};
export const SCORE_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "off" }> = {
  ready: { label: "산정 완료", tone: "ok" },
  provisional: { label: "잠정 산정", tone: "warn" },
  blocked: { label: "계산 보류", tone: "off" },
  "not-played": { label: "미출전", tone: "off" },
};
const WARNINGS: Record<string, string> = {
  BSD_OPTIONAL_METRICS_PROVISIONAL: "제공되지 않거나 확인되지 않은 세부 통계를 제외한 잠정 점수입니다.",
  MATCH_NOT_FINISHED: "경기가 아직 끝나지 않았습니다.",
  EXTRA_TIME_REQUIRES_REVIEW: "연장전·승부차기 경기는 세부 규칙 확정 전까지 보류합니다.",
  INVALID_TEAM: "선수의 소속 팀이 경기 양 팀과 맞지 않습니다.",
  INVALID_MINUTES: "출전 시간 기록을 확인할 수 없습니다.",
  CONFIRMED_LINEUP_REQUIRED: "확정 라인업이 아직 제공되지 않았습니다.",
  INCOMPLETE_STARTERS: "양 팀 선발 11명 정보가 완전하지 않습니다.",
  MATCH_POSITION_REQUIRED: "이 경기에서의 포지션을 확인할 수 없습니다.",
  INCIDENTS_REQUIRED: "경기 사건(득점·카드·교체) 기록이 없습니다.",
  GOAL_TIMELINE_INCOMPLETE: "득점 시간 기록이 완전하지 않습니다.",
  GOAL_SCORE_MISMATCH: "득점 기록과 최종 스코어가 일치하지 않습니다.",
  VAR_REVIEW_REQUIRED: "VAR 판정 결과 확인이 필요합니다.",
  UNKNOWN_CARD_KIND: "해석할 수 없는 카드 기록이 있습니다.",
  DUPLICATE_RED_REVIEW: "중복된 퇴장 기록 확인이 필요합니다.",
  CARD_TIMELINE_MISMATCH: "카드 기록과 선수 통계가 일치하지 않습니다.",
  INVALID_PARTICIPATION: "출전·교체 기록이 일관되지 않습니다.",
  ZERO_MINUTES_CONFLICT: "출전 0분인데 경기 기록이 있습니다.",
  ENTRY_TIME_REQUIRED: "교체 투입 시각이 필요합니다.",
  MINUTES_INTERVAL_MISMATCH: "출전 시간과 교체 기록이 맞지 않습니다.",
  GOAL_BOUNDARY_TIME_AMBIGUOUS: "교체와 같은 분의 득점이라 선후를 확인할 수 없습니다.",
  PLAYER_GOALS_MISMATCH: "선수 득점 수가 사건 기록과 다릅니다.",
  INVALID_PASS_TOTALS: "패스 기록이 올바르지 않습니다.",
  NO_PRICE_CHANGE_FOR_NON_PARTICIPATION: "출전하지 않아 가치가 변하지 않습니다.",
  PROTOTYPE_INCIDENT_COMPLETENESS_ASSUMPTION: "사건 기록이 완전하다고 가정한 잠정 점수입니다.",
};
const METRIC_WARNINGS: Record<string, string> = {
  UNVERIFIED_OR_MISSING_EXCLUDED: "기록이 없거나 확인되지 않아 점수에서 제외했습니다.",
  UNVERIFIED_OR_THRESHOLD_NOT_MET: "기록이 확인되지 않았거나 기준에 못 미쳤습니다.",
  PARTIAL_COUNTERS: "일부 기록만 제공되어 확인된 수치만 반영했습니다.",
};
/** Maps an engine warning code to a sentence; unknown codes fall back to a generic note. */
export function warningText(code: string) {
  if (WARNINGS[code]) return WARNINGS[code];
  const [metric, reason] = code.split(":");
  if (reason && METRIC_WARNINGS[reason]) return `${METRIC_LABELS[metric] ?? metric} — ${METRIC_WARNINGS[reason]}`;
  return "데이터 확인이 필요한 항목이 있습니다.";
}
