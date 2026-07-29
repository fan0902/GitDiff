import type { Metadata } from "next";
import { DiffViewer } from "./DiffViewer";

export const metadata: Metadata = {
  title: "Branch Review · 本地 Git 差异阅读器",
  description: "以文件为章节，清晰阅读任意本地 Git 仓库的分支差异。",
};

export default function Home() {
  return <DiffViewer />;
}
