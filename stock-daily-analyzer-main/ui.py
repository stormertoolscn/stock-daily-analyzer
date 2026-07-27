#!/usr/bin/env python3
"""
Stock Daily Analyzer - Desktop UI
浅色方案对齐 DSA 前端变量；布局参考苹果设置页的清晰层级。
"""
from __future__ import annotations

import logging
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from config import BASE_DIR, REPORT_DIR  # noqa: E402


# —— DSA 默认浅色（与 frontend/src/assets/variables.css 一致）——
C_BG = "#f5f6f8"
C_CARD = "#ffffff"
C_BORDER = "#e2e5ea"
C_TEXT = "#1f2329"
C_MUTED = "#6b7280"
C_ACCENT = "#3b82f6"
C_ACCENT_HOVER = "#2563eb"
C_SUCCESS = "#16a34a"
C_DANGER = "#f5222d"


def _pick_ui_font() -> tuple[str, str]:
    """优先清晰中英混排字体（Windows）。"""
    candidates = [
        "Microsoft YaHei UI",
        "Segoe UI Variable",
        "Segoe UI",
        "PingFang SC",
        "Noto Sans SC",
        "Arial",
    ]
    root = tk.Tk()
    root.withdraw()
    available = set(root.tk.call("font", "families"))
    root.destroy()
    for name in candidates:
        if name in available:
            return name, name
    return "TkDefaultFont", "TkDefaultFont"


class QueueLogHandler(logging.Handler):
    def __init__(self, q: queue.Queue):
        super().__init__()
        self.q = q

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.q.put(("log", self.format(record)))
        except Exception:
            pass


class AnalyzerApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("股票日报助手")
        self.geometry("980x720")
        self.minsize(860, 620)
        self.configure(bg=C_BG)

        self.font_ui, _ = _pick_ui_font()
        self._running = False
        self._msg_q: queue.Queue = queue.Queue()
        self._report_path: Optional[Path] = None
        self._log_handler: Optional[QueueLogHandler] = None

        self._setup_style()
        self._build()
        self.after(120, self._drain_queue)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _font(self, size: int = 13, weight: str = "normal") -> tuple:
        return (self.font_ui, size, weight)

    def _setup_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure(".", background=C_BG, foreground=C_TEXT, font=self._font(13))
        style.configure("TFrame", background=C_BG)
        style.configure("Card.TFrame", background=C_CARD)
        style.configure("TLabel", background=C_BG, foreground=C_TEXT, font=self._font(13))
        style.configure("Card.TLabel", background=C_CARD, foreground=C_TEXT, font=self._font(13))
        style.configure("Title.TLabel", background=C_BG, foreground=C_TEXT, font=self._font(22, "bold"))
        style.configure("Sub.TLabel", background=C_BG, foreground=C_MUTED, font=self._font(13))
        style.configure("Muted.TLabel", background=C_CARD, foreground=C_MUTED, font=self._font(12))
        style.configure("Status.TLabel", background=C_CARD, foreground=C_MUTED, font=self._font(12))

        style.configure(
            "Primary.TButton",
            background=C_ACCENT,
            foreground="#ffffff",
            borderwidth=0,
            focusthickness=0,
            padding=(18, 10),
            font=self._font(14, "bold"),
        )
        style.map(
            "Primary.TButton",
            background=[("active", C_ACCENT_HOVER), ("disabled", "#93c5fd")],
            foreground=[("disabled", "#ffffff")],
        )
        style.configure(
            "Ghost.TButton",
            background=C_CARD,
            foreground=C_TEXT,
            borderwidth=1,
            relief="solid",
            padding=(14, 8),
            font=self._font(13),
        )
        style.map("Ghost.TButton", background=[("active", C_BG)])

        style.configure(
            "Accent.Horizontal.TProgressbar",
            troughcolor=C_BORDER,
            background=C_ACCENT,
            bordercolor=C_BORDER,
            lightcolor=C_ACCENT,
            darkcolor=C_ACCENT,
        )
        style.configure(
            "TSpinbox",
            fieldbackground=C_CARD,
            background=C_CARD,
            foreground=C_TEXT,
            arrowsize=14,
            padding=6,
            font=self._font(13),
        )
        style.configure(
            "TCheckbutton",
            background=C_CARD,
            foreground=C_TEXT,
            font=self._font(13),
            focuscolor=C_CARD,
        )

    def _card(self, parent: tk.Misc, **pack) -> ttk.Frame:
        wrap = tk.Frame(parent, bg=C_BORDER, bd=0, highlightthickness=0)
        inner = tk.Frame(wrap, bg=C_CARD, bd=0, highlightthickness=0)
        inner.pack(fill="both", expand=True, padx=1, pady=1)
        wrap.pack(**pack)
        return inner

    def _build(self) -> None:
        shell = ttk.Frame(self, style="TFrame")
        shell.pack(fill="both", expand=True, padx=28, pady=24)

        # Header — Apple 式大标题 + 一句说明
        ttk.Label(shell, text="股票日报助手", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            shell,
            text="一键扫描 A 股 · 量化筛选 · 生成可读日报",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(6, 18))

        # Settings card
        settings = self._card(shell, fill="x", pady=(0, 14))
        pad = tk.Frame(settings, bg=C_CARD)
        pad.pack(fill="x", padx=20, pady=16)

        row1 = tk.Frame(pad, bg=C_CARD)
        row1.pack(fill="x")
        tk.Label(
            row1, text="扫描数量", bg=C_CARD, fg=C_MUTED, font=self._font(13)
        ).pack(side="left")
        self.var_limit = tk.BooleanVar(value=True)
        self.var_max = tk.IntVar(value=150)
        ttk.Checkbutton(
            row1,
            text="限制（建议试运行先勾选）",
            variable=self.var_limit,
            style="TCheckbutton",
            command=self._sync_spin,
        ).pack(side="left", padx=(16, 10))
        self.spin = ttk.Spinbox(
            row1, from_=20, to=5000, textvariable=self.var_max, width=8, style="TSpinbox"
        )
        self.spin.pack(side="left")
        tk.Label(
            row1, text="只", bg=C_CARD, fg=C_MUTED, font=self._font(13)
        ).pack(side="left", padx=(6, 0))

        row2 = tk.Frame(pad, bg=C_CARD)
        row2.pack(fill="x", pady=(14, 0))
        self.btn_run = ttk.Button(
            row2, text="开始分析", style="Primary.TButton", command=self._start
        )
        self.btn_run.pack(side="left")
        self.btn_stop_hint = tk.Label(
            row2,
            text="运行中请勿关闭窗口",
            bg=C_CARD,
            fg=C_MUTED,
            font=self._font(12),
        )
        self.btn_open_report = ttk.Button(
            row2, text="打开报告", style="Ghost.TButton", command=self._open_report, state="disabled"
        )
        self.btn_open_report.pack(side="left", padx=(10, 0))
        self.btn_open_folder = ttk.Button(
            row2, text="报告文件夹", style="Ghost.TButton", command=self._open_folder
        )
        self.btn_open_folder.pack(side="left", padx=(8, 0))

        self.progress = ttk.Progressbar(
            pad, mode="indeterminate", style="Accent.Horizontal.TProgressbar"
        )
        self.progress.pack(fill="x", pady=(16, 8))
        self.status = ttk.Label(pad, text="就绪", style="Status.TLabel")
        self.status.pack(anchor="w")

        # Report card
        report_card = self._card(shell, fill="both", expand=True, pady=(0, 14))
        rpad = tk.Frame(report_card, bg=C_CARD)
        rpad.pack(fill="both", expand=True, padx=20, pady=16)
        tk.Label(
            rpad, text="分析报告", bg=C_CARD, fg=C_TEXT, font=self._font(15, "bold")
        ).pack(anchor="w", pady=(0, 8))
        self.txt_report = tk.Text(
            rpad,
            wrap="word",
            bg="#fafbfc",
            fg=C_TEXT,
            insertbackground=C_TEXT,
            relief="flat",
            bd=0,
            highlightthickness=1,
            highlightbackground=C_BORDER,
            highlightcolor=C_ACCENT,
            font=self._font(13),
            padx=14,
            pady=12,
        )
        self.txt_report.pack(fill="both", expand=True)
        self.txt_report.insert("1.0", "点击「开始分析」后，报告将显示在这里。")
        self.txt_report.configure(state="disabled")

        # Log card
        log_card = self._card(shell, fill="both", expand=True)
        lpad = tk.Frame(log_card, bg=C_CARD)
        lpad.pack(fill="both", expand=True, padx=20, pady=16)
        tk.Label(
            lpad, text="运行日志", bg=C_CARD, fg=C_TEXT, font=self._font(15, "bold")
        ).pack(anchor="w", pady=(0, 8))
        self.txt_log = tk.Text(
            lpad,
            wrap="word",
            height=8,
            bg="#fafbfc",
            fg=C_MUTED,
            relief="flat",
            bd=0,
            highlightthickness=1,
            highlightbackground=C_BORDER,
            highlightcolor=C_ACCENT,
            font=self._font(12),
            padx=12,
            pady=10,
        )
        self.txt_log.pack(fill="both", expand=True)
        self.txt_log.configure(state="disabled")

        self._sync_spin()

    def _sync_spin(self) -> None:
        state = "normal" if self.var_limit.get() else "disabled"
        self.spin.configure(state=state)

    def _set_status(self, text: str, color: str = C_MUTED) -> None:
        self.status.configure(text=text, foreground=color)

    def _append_log(self, line: str) -> None:
        self.txt_log.configure(state="normal")
        self.txt_log.insert("end", line + "\n")
        self.txt_log.see("end")
        self.txt_log.configure(state="disabled")

    def _set_report(self, text: str) -> None:
        self.txt_report.configure(state="normal")
        self.txt_report.delete("1.0", "end")
        self.txt_report.insert("1.0", text)
        self.txt_report.configure(state="disabled")

    def _start(self) -> None:
        if self._running:
            return
        max_stocks = int(self.var_max.get()) if self.var_limit.get() else None
        if max_stocks is not None and max_stocks < 1:
            messagebox.showwarning("参数无效", "扫描数量至少为 1")
            return

        self._running = True
        self.btn_run.configure(state="disabled")
        self.btn_open_report.configure(state="disabled")
        self.progress.start(12)
        self._set_status("分析进行中…", C_ACCENT)
        self._append_log("—— 开始分析 ——")
        if max_stocks:
            self._append_log(f"扫描上限: {max_stocks}")
        else:
            self._append_log("全市场扫描（耗时较长）")

        # 确保子线程网络不走坏代理
        os.environ.setdefault("NO_PROXY", "*")
        os.environ.setdefault("no_proxy", "*")

        t = threading.Thread(target=self._worker, args=(max_stocks,), daemon=True)
        t.start()

    def _attach_log_handler(self) -> None:
        handler = QueueLogHandler(self._msg_q)
        handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s", "%H:%M:%S"))
        logging.getLogger().addHandler(handler)
        self._log_handler = handler

    def _detach_log_handler(self) -> None:
        if self._log_handler:
            logging.getLogger().removeHandler(self._log_handler)
            self._log_handler = None

    def _worker(self, max_stocks: Optional[int]) -> None:
        try:
            import urllib.request

            urllib.request.getproxies = lambda: {}  # type: ignore[method-assign]
            self._attach_log_handler()
            from main import run_pipeline

            code, report, path, summary = run_pipeline(max_stocks=max_stocks, send_notify=False)
            self._msg_q.put(("done", code, report, path, summary))
        except Exception as e:
            self._msg_q.put(("error", str(e)))
        finally:
            self._detach_log_handler()

    def _drain_queue(self) -> None:
        try:
            while True:
                item = self._msg_q.get_nowait()
                kind = item[0]
                if kind == "log":
                    self._append_log(item[1])
                elif kind == "done":
                    _code, report, path, summary = item[1], item[2], item[3], item[4]
                    self._on_done(_code, report, path, summary)
                elif kind == "error":
                    self._on_error(item[1])
        except queue.Empty:
            pass
        self.after(120, self._drain_queue)

    def _on_done(self, code: int, report: str, path: Optional[Path], summary: dict) -> None:
        self._running = False
        self.progress.stop()
        self.btn_run.configure(state="normal")
        scanned = summary.get("total_scanned", 0) if summary else 0
        if code == 0:
            self._set_report(report or "(无报告内容)")
            self._report_path = path
            if path:
                self.btn_open_report.configure(state="normal")
            self._set_status(f"完成 · 扫描 {scanned} 只 · 报告已生成", C_SUCCESS)
            self._append_log("—— 分析完成 ——")
        else:
            self._set_report(report or "分析失败")
            self._set_status("分析失败，请查看日志", C_DANGER)
            self._append_log(f"失败: {report}")

    def _on_error(self, msg: str) -> None:
        self._running = False
        self.progress.stop()
        self.btn_run.configure(state="normal")
        self._set_status("出错", C_DANGER)
        self._append_log(msg)
        messagebox.showerror("运行错误", msg)

    def _open_report(self) -> None:
        path = self._report_path
        if not path or not Path(path).exists():
            # fallback latest
            files = sorted(REPORT_DIR.glob("report_*.txt"), reverse=True)
            if not files:
                messagebox.showinfo("提示", "还没有报告文件")
                return
            path = files[0]
        try:
            os.startfile(str(path))  # type: ignore[attr-defined]
        except Exception:
            subprocess.Popen(["notepad.exe", str(path)])

    def _open_folder(self) -> None:
        REPORT_DIR.mkdir(exist_ok=True)
        try:
            os.startfile(str(REPORT_DIR))  # type: ignore[attr-defined]
        except Exception as e:
            messagebox.showerror("无法打开", str(e))

    def _on_close(self) -> None:
        if self._running:
            if not messagebox.askyesno("确认退出", "分析仍在进行，确定退出？"):
                return
        self.destroy()


def main() -> None:
    # 高 DPI 清晰显示（Windows）
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            import ctypes

            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

    app = AnalyzerApp()
    app.mainloop()


if __name__ == "__main__":
    main()
