import { App } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { approval, type Approval } from "../shared/contracts";

const root = createRoot(document.getElementById("root")!);
const app = new App({ name: "Supdance", version: "0.1.1" });
const english = navigator.language.toLowerCase().startsWith("en");
const t = english
  ? { review: "Review in Supdance", credit: "Estimated credits", heading: "Operation preview", loading: "Waiting for the Supdance result" }
  : { review: "前往 Supdance 确认", credit: "预计积分", heading: "操作预览", loading: "等待 Supdance 返回结果" };
function render(result?: Approval) {
  root.render(<main>
    <b>Supdance</b>
    <h2>{t.heading}</h2>
    {result ? <>
      <p role="status">{result.status} · {t.credit} {result.quote.credits}</p>
      <pre>{JSON.stringify(result.receipt ?? result.action, null, 2)}</pre>
      <button onClick={() => void app.openLink({ url: result.reviewUrl }).catch(() => {
        const link = document.createElement("a");
        link.textContent = t.review;
        link.href = result.reviewUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.querySelector("main")?.append(link);
      })}>{t.review}</button>
    </> : <p role="status">{t.loading}</p>}
  </main>);
}
render();
app.ontoolresult = ({ structuredContent }) => {
  const result = approval.safeParse((structuredContent as Record<string, unknown> | undefined)?.approval);
  if (result.success && result.data.reviewUrl.startsWith("https://")) render(result.data);
};
void app.connect();
