import type { Lang } from "./copy";

const zh: Record<string, string> = {
  title: "标题", goal: "创作目标", assumptions: "创作假设", steps: "执行步骤", skill: "技能", reason: "原因",
  logline: "一句话梗概", world: "世界观", episodes: "分集", conflict: "冲突", beats: "剧情节拍", cliffhanger: "悬念",
  continuity: "连续性", name: "名称", appearance: "外貌", personality: "性格", motivation: "动机", relationships: "人物关系",
  arc: "成长线", visualConsistency: "视觉一致性", dialogueStyle: "台词风格", episode: "集数", scenes: "场景",
  heading: "场景标题", action: "动作", dialogue: "对白", hook: "钩子", choices: "改写理由", shots: "分镜",
  number: "镜头编号", scene: "关联场景", framing: "景别", camera: "机位", movement: "运镜", durationSeconds: "时长（秒）",
  setting: "场景描述", sound: "声音", lighting: "光影", imagePrompt: "图片提示词", videoPrompt: "视频提示词",
  kind: "操作类别", projectId: "项目 ID", canvasId: "画布 ID", revision: "版本", nodeIds: "节点 ID",
  project: "项目", summary: "摘要", model: "模型", prompt: "提示词", shotNumber: "关联镜头编号",
  task: "任务", status: "状态", progress: "进度", assetIds: "资产 ID", errorCode: "错误码",
};

function label(key: string, lang: Lang) {
  return (lang === "zh-CN" && zh[key]) || key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function Artifact({ data, lang }: { data: Record<string, unknown>; lang: Lang }) {
  function render(value: unknown) {
    if (Array.isArray(value)) return <ol>{value.map((item, index) => <li key={index}>{render(item)}</li>)}</ol>;
    if (isObject(value)) return <Artifact data={value} lang={lang} />;
    return String(value ?? "");
  }
  return <dl className="artifact">
    {Object.entries(data).map(([key, value]) => <div key={key}><dt>{label(key, lang)}</dt><dd>{render(value)}</dd></div>)}
  </dl>;
}

export function ArtifactFields({ data, lang, change }: {
  data: Record<string, unknown>; lang: Lang; change: (value: Record<string, unknown>) => void;
}) {
  function render(name: string, value: unknown, set: (next: unknown) => void) {
    if (Array.isArray(value)) return <fieldset><legend>{name}</legend>
      {value.map((item, index) => <div key={index}>{render(String(index + 1), item, (next) =>
        set(value.map((old, position) => position === index ? next : old)))}</div>)}
    </fieldset>;
    if (isObject(value)) return <fieldset><legend>{name}</legend><ArtifactFields data={value} lang={lang} change={set} /></fieldset>;
    if (typeof value === "number") return <label>{name}<input type="number" step="any" value={value} onChange={(e) => set(Number(e.target.value))} /></label>;
    return <label>{name}<textarea rows={2} value={String(value ?? "")} onChange={(e) => set(e.target.value)} /></label>;
  }
  return <div className="artifact-fields">
    {Object.entries(data).map(([key, value]) =>
      <div key={key}>{render(label(key, lang), value, (next) => change({ ...data, [key]: next }))}</div>)}
  </div>;
}
