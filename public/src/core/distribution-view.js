const lanes = new Set(["推荐池", "通知池", "实验池"]);

export function distributionLane(value) {
  const lane = String(value || "").trim();
  return lanes.has(lane) ? lane : "推荐池";
}

export function distributionLaneClass(value) {
  return {
    推荐池: "recommendation",
    通知池: "notification",
    实验池: "experiment",
  }[distributionLane(value)];
}

export function readerStakeText(value) {
  return String(value || "").trim() || "待编辑会明确具体读者利益";
}
