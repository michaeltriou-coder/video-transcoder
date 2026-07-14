using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace KtvDownloader
{
    // Windows Job Object so the whole process tree (node -> yt-dlp/ffmpeg/whisper/chromium)
    // dies together, even if the launcher is killed.
    static class Job
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr a, string lpName);
        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr hJob, int infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        const int ExtendedLimitInformation = 9;
        const uint KILL_ON_JOB_CLOSE = 0x2000;
        static IntPtr handle = IntPtr.Zero;

        public static void Init()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            var ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            ext.BasicLimitInformation.LimitFlags = KILL_ON_JOB_CLOSE;
            int len = Marshal.SizeOf(ext);
            IntPtr p = Marshal.AllocHGlobal(len);
            Marshal.StructureToPtr(ext, p, false);
            SetInformationJobObject(handle, ExtendedLimitInformation, p, (uint)len);
            Marshal.FreeHGlobal(p);
        }
        public static void Assign(Process proc)
        {
            if (handle != IntPtr.Zero) AssignProcessToJobObject(handle, proc.Handle);
        }
        public static void KillAll()
        {
            if (handle != IntPtr.Zero) TerminateJobObject(handle, 0);
        }
    }

    public class MainForm : Form
    {
        const int PORT = 5000;
        readonly string root, nodeExe, serverJs, appDir, binDir, browsersDir, modelsDir, dataDir;

        Process server;
        readonly bool autoStart;
        readonly Label status = new Label();
        readonly Button startBtn = new Button();
        readonly Button stopBtn = new Button();
        readonly Button openBtn = new Button();
        readonly TextBox log = new TextBox();
        readonly Timer poll = new Timer();
        bool starting = false;

        public MainForm(bool autoStart)
        {
            this.autoStart = autoStart;
            root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            nodeExe = Path.Combine(root, "runtime", "node.exe");
            appDir = Path.Combine(root, "app");
            serverJs = Path.Combine(appDir, "server.js");
            binDir = Path.Combine(root, "bin");
            browsersDir = Path.Combine(root, "browsers");
            modelsDir = Path.Combine(root, "models");
            dataDir = Path.Combine(root, "data");

            Text = "KTV Downloader";
            Width = 460; Height = 340;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9f);
            BackColor = Color.FromArgb(30, 30, 34);
            ForeColor = Color.Gainsboro;

            var title = new Label();
            title.Text = "KTV Downloader";
            title.Font = new Font("Segoe UI Semibold", 13f, FontStyle.Bold);
            title.ForeColor = Color.White;
            title.SetBounds(16, 12, 300, 26);
            Controls.Add(title);

            status.SetBounds(16, 44, 420, 24);
            status.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            Controls.Add(status);

            startBtn.Text = "Start";
            startBtn.SetBounds(16, 78, 120, 40);
            startBtn.FlatStyle = FlatStyle.Flat;
            startBtn.BackColor = Color.FromArgb(0, 120, 60);
            startBtn.ForeColor = Color.White;
            startBtn.Click += (s, e) => StartServer();
            Controls.Add(startBtn);

            stopBtn.Text = "Stop";
            stopBtn.SetBounds(148, 78, 120, 40);
            stopBtn.FlatStyle = FlatStyle.Flat;
            stopBtn.BackColor = Color.FromArgb(150, 40, 40);
            stopBtn.ForeColor = Color.White;
            stopBtn.Click += (s, e) => StopServer(true);
            Controls.Add(stopBtn);

            openBtn.Text = "Open UI";
            openBtn.SetBounds(280, 78, 150, 40);
            openBtn.FlatStyle = FlatStyle.Flat;
            openBtn.BackColor = Color.FromArgb(50, 50, 58);
            openBtn.ForeColor = Color.White;
            openBtn.Click += (s, e) => OpenUi();
            Controls.Add(openBtn);

            log.SetBounds(16, 130, 414, 160);
            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.BackColor = Color.FromArgb(20, 20, 24);
            log.ForeColor = Color.LightGray;
            log.Font = new Font("Consolas", 8.5f);
            Controls.Add(log);

            poll.Interval = 1500;
            poll.Tick += (s, e) => Refresh2();
            poll.Start();
            Refresh2();

            FormClosing += (s, e) => { StopServer(false); Job.KillAll(); };

            if (autoStart)
                Shown += (s, e) => { if (!PortOpen(PORT)) StartServer(); };
        }

        void Append(string line)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { BeginInvoke(new Action<string>(Append), line); return; }
            if (log.TextLength > 60000) log.Text = log.Text.Substring(30000);
            log.AppendText(line + "\r\n");
        }

        static bool PortOpen(int port)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect("127.0.0.1", port, null, null);
                    bool ok = ar.AsyncWaitHandle.WaitOne(250);
                    if (ok) { c.EndConnect(ar); return true; }
                    return false;
                }
            }
            catch { return false; }
        }

        void StartServer()
        {
            if (PortOpen(PORT)) { Append("Server already running."); Refresh2(); return; }
            if (!File.Exists(nodeExe)) { Append("ERROR: runtime\\node.exe not found."); return; }
            if (!File.Exists(serverJs)) { Append("ERROR: app\\server.js not found."); return; }

            starting = true; Refresh2();
            try
            {
                var psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = "\"" + serverJs + "\"";
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.EnvironmentVariables["KTV_ROOT"] = root;
                psi.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = browsersDir;
                psi.EnvironmentVariables["KTV_MODELS_DIR"] = modelsDir;
                psi.EnvironmentVariables["STORAGE_PATH"] = dataDir;
                psi.EnvironmentVariables["PORT"] = PORT.ToString();
                string oldPath = psi.EnvironmentVariables.ContainsKey("PATH") ? psi.EnvironmentVariables["PATH"] : "";
                psi.EnvironmentVariables["PATH"] = binDir + ";" + oldPath;

                server = new Process();
                server.StartInfo = psi;
                server.EnableRaisingEvents = true;
                server.OutputDataReceived += (s, e) => { if (e.Data != null) Append(e.Data); };
                server.ErrorDataReceived += (s, e) => { if (e.Data != null) Append(e.Data); };
                server.Exited += (s, e) => { Append("Server stopped."); starting = false; BeginInvoke(new Action(Refresh2)); };
                server.Start();
                Job.Assign(server);
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();
                Append("Starting server...");
            }
            catch (Exception ex) { Append("ERROR: " + ex.Message); starting = false; }
        }

        void StopServer(bool user)
        {
            poll.Stop();
            try
            {
                if (server != null && !server.HasExited)
                {
                    try { Process.Start(new ProcessStartInfo("taskkill", "/PID " + server.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(3000); }
                    catch { }
                    if (!server.HasExited) server.Kill();
                }
            }
            catch { }
            Job.KillAll();
            server = null;
            starting = false;
            if (user) Append("Stopped.");
            poll.Start();
            Refresh2();
        }

        void OpenUi()
        {
            try { Process.Start("http://localhost:" + PORT + "/"); }
            catch (Exception ex) { Append("ERROR opening browser: " + ex.Message); }
        }

        void Refresh2()
        {
            bool up = PortOpen(PORT);
            if (up)
            {
                status.Text = "●  Running  —  http://localhost:" + PORT;
                status.ForeColor = Color.FromArgb(80, 220, 120);
                startBtn.Enabled = false;
                stopBtn.Enabled = true;
                openBtn.Enabled = true;
            }
            else if (starting)
            {
                status.Text = "●  Starting...";
                status.ForeColor = Color.Gold;
                startBtn.Enabled = false;
                stopBtn.Enabled = true;
                openBtn.Enabled = false;
            }
            else
            {
                status.Text = "●  Stopped";
                status.ForeColor = Color.FromArgb(220, 90, 90);
                startBtn.Enabled = true;
                stopBtn.Enabled = false;
                openBtn.Enabled = false;
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            bool auto = false;
            foreach (var a in args)
            {
                var t = a.TrimStart('-', '/').ToLowerInvariant();
                if (t == "autostart" || t == "start") auto = true;
            }
            Job.Init();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(auto));
        }
    }
}
