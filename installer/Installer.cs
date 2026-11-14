// Lumicord Installer: wizard (License -> Action -> Discord versions -> Install). Flat dark style, one accent color.
// Build: installer\build.cmd  (uses the C# compiler that ships with Windows, no downloads)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

// Palette: background family + one accent + neutral grays (plus red for errors only).
static class Theme {
    public static readonly Color Bg = Color.FromArgb(13, 14, 18);
    public static readonly Color Surface = Color.FromArgb(22, 23, 28);
    public static readonly Color SurfaceHover = Color.FromArgb(30, 32, 38);
    public static readonly Color Border = Color.FromArgb(44, 46, 54);
    public static readonly Color Accent = Color.FromArgb(236, 72, 153); // pink
    public static readonly Color Text = Color.FromArgb(240, 241, 245);
    public static readonly Color Muted = Color.FromArgb(128, 132, 144);
    public static readonly Color Danger = Color.FromArgb(218, 55, 60);

    static readonly Dictionary<string, Font> fonts = new Dictionary<string, Font>();
    public static Font F(float size, FontStyle s = FontStyle.Regular) {
        string k = size + "|" + s; Font f;
        if (!fonts.TryGetValue(k, out f)) fonts[k] = f = new Font("Segoe UI", size, s);
        return f;
    }
    // Grayscale anti-aliased text (ClearType fringes on custom-painted backgrounds).
    public static void Draw(Graphics g, string text, Font font, RectangleF r, Color c,
                            StringAlignment h = StringAlignment.Near, StringAlignment v = StringAlignment.Near, bool wrap = false) {
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
        using (var b = new SolidBrush(c))
        using (var sf = new StringFormat(wrap ? 0 : StringFormatFlags.NoWrap) { Alignment = h, LineAlignment = v, Trimming = StringTrimming.EllipsisPath })
            g.DrawString(text, font, b, r, sf);
    }
    public static Color Mix(Color a, Color b, float t) {
        t = Math.Max(0, Math.Min(1, t));
        return Color.FromArgb((int)(a.A + (b.A - a.A) * t), (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }
    public static Color Alpha(Color c, int a) { return Color.FromArgb(Math.Max(0, Math.Min(255, a)), c); }
    public static GraphicsPath Round(RectangleF r, float rad) {
        var p = new GraphicsPath(); float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure(); return p;
    }
    public static float Ease(float t) { return 1 - (float)Math.Pow(1 - t, 3); }
}

// Vector icons drawn with GDI+ paths (no font glyphs or brand logos).
static class Icons {
    public static void Draw(Graphics g, string name, RectangleF r, Color c) {
        float s = r.Width, x = r.X, y = r.Y, cx = x + s / 2, cy = y + s / 2;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var pen = new Pen(c, Math.Max(1.5f, s * 0.09f)) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
        using (var brush = new SolidBrush(c)) {
            switch (name) {
                case "sparkle": using (var p = Sparkle(cx, cy, s / 2)) g.FillPath(brush, p); break;
                case "download":
                    g.DrawLine(pen, cx, y + s * 0.12f, cx, y + s * 0.62f);
                    g.DrawLines(pen, new[] { new PointF(cx - s * 0.22f, y + s * 0.42f), new PointF(cx, y + s * 0.64f), new PointF(cx + s * 0.22f, y + s * 0.42f) });
                    g.DrawLine(pen, x + s * 0.18f, y + s * 0.86f, x + s * 0.82f, y + s * 0.86f);
                    break;
                case "repair": {
                    float rad = s * 0.32f;
                    g.DrawArc(pen, cx - rad, cy - rad, rad * 2, rad * 2, 20, 290);
                    double th = (20 + 290) * Math.PI / 180;
                    float nx = (float)Math.Cos(th), ny = (float)Math.Sin(th), tx = -ny, ty = nx, h = s * 0.16f;
                    var tip = new PointF(cx + nx * rad + tx * h * 0.6f, cy + ny * rad + ty * h * 0.6f);
                    g.DrawLines(pen, new[] { new PointF(tip.X - tx * h + nx * h, tip.Y - ty * h + ny * h), tip, new PointF(tip.X - tx * h - nx * h, tip.Y - ty * h - ny * h) });
                    break;
                }
                case "trash":
                    g.DrawLine(pen, x + s * 0.18f, y + s * 0.26f, x + s * 0.82f, y + s * 0.26f);
                    g.DrawLine(pen, x + s * 0.4f, y + s * 0.14f, x + s * 0.6f, y + s * 0.14f);
                    using (var p = Theme.Round(new RectangleF(x + s * 0.26f, y + s * 0.34f, s * 0.48f, s * 0.52f), s * 0.06f)) g.DrawPath(pen, p);
                    break;
                case "x":
                    g.DrawLine(pen, x + s * 0.25f, y + s * 0.25f, x + s * 0.75f, y + s * 0.75f);
                    g.DrawLine(pen, x + s * 0.75f, y + s * 0.25f, x + s * 0.25f, y + s * 0.75f);
                    break;
                case "minus": g.DrawLine(pen, x + s * 0.25f, cy, x + s * 0.75f, cy); break;
                case "app": {
                    var w = new RectangleF(x + s * 0.12f, y + s * 0.2f, s * 0.76f, s * 0.6f);
                    using (var p = Theme.Round(w, s * 0.1f)) g.DrawPath(pen, p);
                    g.DrawLine(pen, w.X, w.Y + s * 0.2f, w.Right, w.Y + s * 0.2f);
                    float d = s * 0.07f;
                    g.FillEllipse(brush, w.X + s * 0.08f, w.Y + s * 0.065f, d, d);
                    g.FillEllipse(brush, w.X + s * 0.19f, w.Y + s * 0.065f, d, d);
                    break;
                }
                case "doc": {
                    using (var p = Theme.Round(new RectangleF(x + s * 0.2f, y + s * 0.1f, s * 0.6f, s * 0.8f), s * 0.08f)) g.DrawPath(pen, p);
                    for (int i = 0; i < 3; i++) g.DrawLine(pen, x + s * 0.34f, y + s * (0.34f + i * 0.16f), x + s * 0.66f, y + s * (0.34f + i * 0.16f));
                    break;
                }
                case "windowcheck": {
                    var w = new RectangleF(x + s * 0.06f, y + s * 0.12f, s * 0.7f, s * 0.62f);
                    using (var p = Theme.Round(w, s * 0.1f)) g.DrawPath(pen, p);
                    g.DrawLine(pen, w.X, w.Y + s * 0.18f, w.Right, w.Y + s * 0.18f);
                    using (var bg = new SolidBrush(c)) g.FillEllipse(bg, x + s * 0.5f, y + s * 0.5f, s * 0.46f, s * 0.46f);
                    using (var wp = new Pen(Color.White, Math.Max(1.4f, s * 0.07f)) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                        g.DrawLines(wp, new[] { new PointF(x + s * 0.62f, y + s * 0.73f), new PointF(x + s * 0.71f, y + s * 0.82f), new PointF(x + s * 0.85f, y + s * 0.65f) });
                    break;
                }
                case "folder": {
                    // tab + body, filled, vertically centered in the box (0.18..0.82)
                    using (var tab = Theme.Round(new RectangleF(x + s * 0.1f, y + s * 0.18f, s * 0.36f, s * 0.2f), s * 0.06f)) g.FillPath(brush, tab);
                    using (var bodyP = Theme.Round(new RectangleF(x + s * 0.1f, y + s * 0.3f, s * 0.8f, s * 0.52f), s * 0.08f)) g.FillPath(brush, bodyP);
                    break;
                }
                case "code":
                    g.DrawLines(pen, new[] { new PointF(x + s * 0.34f, y + s * 0.28f), new PointF(x + s * 0.12f, cy), new PointF(x + s * 0.34f, y + s * 0.72f) });
                    g.DrawLines(pen, new[] { new PointF(x + s * 0.66f, y + s * 0.28f), new PointF(x + s * 0.88f, cy), new PointF(x + s * 0.66f, y + s * 0.72f) });
                    break;
                case "heart": {
                    // two lobes + point, built so its visual box spans 0.12..0.88 both ways (centered)
                    var p = new GraphicsPath();
                    p.AddBezier(cx, y + s * 0.88f, x + s * 0.02f, y + s * 0.56f, x + s * 0.12f, y + s * 0.1f, cx, y + s * 0.3f);
                    p.AddBezier(cx, y + s * 0.3f, x + s * 0.88f, y + s * 0.1f, x + s * 0.98f, y + s * 0.56f, cx, y + s * 0.88f);
                    p.CloseFigure();
                    var b = p.GetBounds();
                    using (var m = new Matrix()) { m.Translate(cx - (b.X + b.Width / 2), cy - (b.Y + b.Height / 2)); p.Transform(m); }
                    g.FillPath(brush, p); p.Dispose();
                    break;
                }
            }
        }
    }
    public static GraphicsPath Sparkle(float cx, float cy, float r) {
        var p = new GraphicsPath(); float k = r * 0.16f;
        p.AddBezier(cx, cy - r, cx + k, cy - k, cx + k, cy - k, cx + r, cy);
        p.AddBezier(cx + r, cy, cx + k, cy + k, cx + k, cy + k, cx, cy + r);
        p.AddBezier(cx, cy + r, cx - k, cy + k, cx - k, cy + k, cx - r, cy);
        p.AddBezier(cx - r, cy, cx - k, cy - k, cx - k, cy - k, cx, cy - r);
        p.CloseFigure(); return p;
    }
}

// One shared ~60fps clock for the (few, subtle) animations.
static class Anim {
    public static event Action Tick;
    public static readonly Stopwatch Clock = Stopwatch.StartNew();
    public static float Now { get { return (float)Clock.Elapsed.TotalSeconds; } }
    static readonly Timer timer = new Timer { Interval = 16 };
    static Anim() { timer.Tick += (s, e) => { if (Tick != null) Tick(); }; timer.Start(); }
    public static float Step(float v, float target, float speed = 0.22f) { return Math.Abs(target - v) < 0.002f ? target : v + (target - v) * speed; }
}

class AnimControl : Control {
    protected float hover;
    public AnimControl() {
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
        Cursor = Cursors.Hand;
        Anim.Tick += OnTick;
    }
    protected bool Hovered { get { return Enabled && IsHandleCreated && ClientRectangle.Contains(PointToClient(MousePosition)); } }
    protected virtual void OnTick() {
        if (IsDisposed) { Anim.Tick -= OnTick; return; }
        float t = Anim.Step(hover, Hovered ? 1 : 0);
        // Evaluate Animating every tick: it advances the control's own animation. With `t != hover || Animating`
        // it was skipped while the hover fade ran, so e.g. the checkbox tick appeared only after the mouse settled.
        bool animating = Animating;
        if (t != hover || animating) { hover = t; Invalidate(); }
    }
    protected virtual bool Animating { get { return false; } }
    protected override void Dispose(bool d) { Anim.Tick -= OnTick; base.Dispose(d); }
}

// Buttons: Primary (accent fill), Outline (border only), Light (white fill, accent text).
enum BtnStyle { Primary, Outline, Light }
class FlatButton : AnimControl {
    public BtnStyle Style;
    public FlatButton(string text, BtnStyle style = BtnStyle.Primary) { Text = text; Style = style; Font = Theme.F(10.5f); Size = new Size(96, 38); }
    protected override void OnPaint(PaintEventArgs e) {
        // Clear with our own BackColor (set by the row behind us), not Parent.BackColor: the Row control's own
        // BackColor is the window color, which left black corners around Browse on the pink selected row.
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(BackColor);
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        Color fill, fg, border;
        if (!Enabled) { fill = Theme.Surface; fg = Theme.Muted; border = Theme.Border; }
        else if (Style == BtnStyle.Primary) { fill = Theme.Mix(Theme.Accent, Color.White, hover * 0.1f); fg = Color.White; border = fill; }
        else if (Style == BtnStyle.Light) { fill = Theme.Mix(Color.White, Theme.Text, hover); fg = Theme.Accent; border = fill; }
        else { fill = Theme.Mix(BackColor, Theme.SurfaceHover, hover); fg = Theme.Text; border = Theme.Border; }
        using (var p = Theme.Round(r, 4)) {
            using (var b = new SolidBrush(fill)) g.FillPath(b, p);
            using (var pen = new Pen(border)) g.DrawPath(pen, p);
        }
        Theme.Draw(g, Text, Font, ClientRectangle, fg, StringAlignment.Center, StringAlignment.Center);
    }
    protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }
    protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }
}

// Round dark icon button (bottom-left links, title bar controls).
class IconButton : AnimControl {
    public string Icon; public bool Round = true; public Color HoverColor = Theme.SurfaceHover;
    public IconButton(string icon, int size) { Icon = icon; Size = new Size(size, size); BackColor = Color.Transparent; }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        if (Round) using (var b = new SolidBrush(Theme.Mix(Theme.Surface, HoverColor, hover))) g.FillEllipse(b, 0.5f, 0.5f, Width - 1, Height - 1);
        else if (hover > 0.01f) using (var b = new SolidBrush(Theme.Alpha(HoverColor, (int)(255 * hover)))) g.FillRectangle(b, ClientRectangle);
        float s = Width * 0.44f;
        Icons.Draw(g, Icon, new RectangleF((Width - s) / 2, (Height - s) / 2, s, s), Theme.Mix(Theme.Muted, Theme.Text, hover));
    }
}

// Full-width selectable row: icon, title, subtitle, optional Browse button. Selected = accent fill.
class Row : AnimControl {
    public string Title, Sub, Icon; public bool Selected; float sel;
    public Image AppIcon; // the real app icon (read from the installed .exe) when available
    // "Not found" is shown with Found=false instead of Enabled=false: a disabled control disables its children,
    // and Browse must stay clickable so users can point at a Discord installed elsewhere.
    public bool Found = true;
    public readonly FlatButton Browse;
    public Row(string icon, string title, string sub, bool withBrowse) {
        Icon = icon; Title = title; Sub = sub; Size = new Size(612, 64);
        if (withBrowse) { Browse = new FlatButton("Browse", BtnStyle.Outline) { Size = new Size(90, 34), Location = new Point(612 - 90 - 15, 15) }; Controls.Add(Browse); }
    }
    protected override bool Animating { get { float t = Anim.Step(sel, Selected ? 1 : 0); bool ch = t != sel; sel = t; if (ch && Browse != null) { Browse.Style = Selected ? BtnStyle.Light : BtnStyle.Outline; Browse.BackColor = BackColorNow; Browse.Invalidate(); } return ch; } }
    Color BackColorNow { get { return Theme.Mix(Theme.Mix(Theme.Surface, Theme.SurfaceHover, Found ? hover : 0), Theme.Accent, sel); } }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        var back = BackColorNow;
        using (var p = Theme.Round(new RectangleF(0, 0, Width - 1, Height - 1), 6)) using (var b = new SolidBrush(back)) g.FillPath(b, p);
        if (Browse != null && Browse.BackColor != back) { Browse.BackColor = back; Browse.Invalidate(); }
        var fg = !Found ? Theme.Alpha(Theme.Muted, 150) : Theme.Mix(Theme.Text, Color.White, sel);
        var sub = !Found ? Theme.Alpha(Theme.Muted, 120) : Theme.Mix(Theme.Muted, Theme.Alpha(Color.White, 220), sel);
        // icon tile
        if (AppIcon != null) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            using (var ia = new System.Drawing.Imaging.ImageAttributes()) {
                if (!Found) ia.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix { Matrix33 = 0.45f });
                g.DrawImage(AppIcon, new Rectangle(16, 14, 36, 36), 0, 0, AppIcon.Width, AppIcon.Height, GraphicsUnit.Pixel, ia);
            }
        } else {
            using (var tile = Theme.Round(new RectangleF(16, 14, 36, 36), 8))
            using (var tb = new SolidBrush(sel > 0.5f ? Theme.Alpha(Color.White, 40) : Theme.Bg)) g.FillPath(tb, tile);
            Icons.Draw(g, Icon, new RectangleF(24, 22, 20, 20), sel > 0.5f ? Color.White : (Found ? Theme.Accent : Theme.Muted));
        }
        int textW = Width - 70 - (Browse != null ? 120 : 20);
        Theme.Draw(g, Title, Theme.F(11.5f, FontStyle.Bold), new RectangleF(66, 11, textW, 22), fg);
        Theme.Draw(g, Sub, Theme.F(9.5f), new RectangleF(66, 33, textW, 20), sub);
    }
}

// Flat checkbox with a drawn tick.
class Check : AnimControl {
    bool on; float t;
    public event EventHandler Changed;
    public bool Checked { get { return on; } }
    public void Toggle() { OnClick(EventArgs.Empty); }
    public Check(string text) { Text = text; Font = Theme.F(10); Size = new Size(300, 26); }
    protected override void OnClick(EventArgs e) { on = !on; if (Changed != null) Changed(this, e); base.OnClick(e); }
    protected override bool Animating { get { float n = Anim.Step(t, on ? 1 : 0, 0.3f); bool ch = n != t; t = n; return ch; } }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        var r = new RectangleF(1, 4, 18, 18);
        using (var p = Theme.Round(r, 4)) {
            using (var b = new SolidBrush(Theme.Mix(Theme.Surface, Theme.Accent, t))) g.FillPath(b, p);
            using (var pen = new Pen(Theme.Mix(Theme.Mix(Theme.Border, Theme.Muted, hover), Theme.Accent, t))) g.DrawPath(pen, p);
        }
        if (t > 0.02f) using (var pen = new Pen(Theme.Alpha(Color.White, (int)(255 * t)), 2f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            g.DrawLines(pen, new[] { new PointF(5, 13), new PointF(8.5f, 16.5f), new PointF(15, 9.5f) });
        Theme.Draw(g, Text, Font, new RectangleF(28, 0, Width - 28, Height), Theme.Text, StringAlignment.Near, StringAlignment.Center);
    }
}

// Flat progress bar; a soft moving highlight while busy.
class Bar : AnimControl {
    public float Target; float v; public bool Busy = true; public Color Fill = Theme.Accent;
    public Bar() { Cursor = Cursors.Default; Size = new Size(612, 6); }
    protected override bool Animating { get { float n = Anim.Step(v, Target, 0.08f); bool ch = n != v; v = n; return Busy || ch; } } // idle once finished
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        using (var p = Theme.Round(new RectangleF(0, 0, Width - 1, Height - 1), 3)) using (var b = new SolidBrush(Theme.Surface)) g.FillPath(b, p);
        float w = Math.Max(Height, (Width - 1) * v);
        using (var p = Theme.Round(new RectangleF(0, 0, w, Height - 1), 3)) {
            using (var b = new SolidBrush(Fill)) g.FillPath(b, p);
            if (Busy) {
                float x = ((Anim.Now * 0.5f) % 1.4f - 0.2f) * w;
                var sr = new RectangleF(x - 50, 0, 100, Height);
                using (var sb = new LinearGradientBrush(sr, Color.Transparent, Color.Transparent, 0f)) {
                    sb.InterpolationColors = new ColorBlend { Colors = new[] { Color.Transparent, Theme.Alpha(Color.White, 70), Color.Transparent }, Positions = new[] { 0f, 0.5f, 1f } };
                    g.SetClip(p); g.FillRectangle(sb, sr); g.ResetClip();
                }
            }
        }
    }
}

class Canvas : Panel { public Canvas() { DoubleBuffered = true; SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint, true); } }

class Wizard : Form {
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern int SendMessage(IntPtr h, int msg, int w, int l);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr h, string app, string idList);
    // Windows' own dark style for a control's scrollbars (Windows 10 1809+); the default is a bright white bar.
    static void DarkScrollbars(Control c) {
        Action apply = () => { try { SetWindowTheme(c.Handle, "DarkMode_Explorer", null); } catch { } };
        if (c.IsHandleCreated) apply(); else c.HandleCreated += (s, e) => apply();
    }

    const int W = 660, H = 450;
    int step;
    string action, channel;
    readonly Dictionary<string, string> customDirs = new Dictionary<string, string>(); // channel -> folder picked with Browse
    readonly Canvas titleBar = new Canvas { Location = new Point(0, 0), Size = new Size(W, 40), BackColor = Theme.Bg };
    readonly Canvas viewport = new Canvas { Location = new Point(0, 40), Size = new Size(W, 336), BackColor = Theme.Bg };
    Canvas body;
    float slideStart = -1; int slideDir = 1;
    float progress; int frame; // title-bar progress line (0..1) and frame counter
    Bitmap logo;               // the app icon, drawn small in the title bar
    bool installing;           // closing is blocked while files are being changed
    bool separateProfile;      // "don't share": this Discord version gets its own plugins/themes/settings
    readonly FlatButton back = new FlatButton("Back", BtnStyle.Outline);
    readonly FlatButton next = new FlatButton("Next");

    static readonly string[,] Builds = { { "Discord", "Discord" }, { "DiscordPTB", "Discord PTB" }, { "DiscordCanary", "Discord Canary" } };
    static string Local { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
    static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Lumicord"); } }

    protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; } } // drop shadow

    public Wizard() {
        Text = "Lumicord Installer"; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(W, H); BackColor = Theme.Bg; ForeColor = Theme.Text; DoubleBuffered = true; Opacity = 0;
        // our own exe (not Application.ExecutablePath, which is the host process when the form is hosted elsewhere)
        try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); logo = new Icon(Icon, 32, 32).ToBitmap(); } catch { }

        // title bar: slow pink glow drifting behind a small logo, plus a thin line showing wizard progress
        titleBar.Paint += (s, e) => {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            float now = Anim.Now, gx = W * 0.5f + (float)Math.Sin(now * 0.35) * W * 0.32f;
            using (var glow = new GraphicsPath()) {
                glow.AddEllipse(gx - 220, -70, 440, 120);
                using (var pb = new PathGradientBrush(glow) { CenterColor = Theme.Alpha(Theme.Accent, 38), SurroundColors = new[] { Color.Transparent } }) g.FillPath(pb, glow);
            }
            if (logo != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(logo, new Rectangle(14, 10, 20, 20)); }
            else Icons.Draw(g, "sparkle", new RectangleF(16, 11, 18, 18), Theme.Accent);
            using (var track = new SolidBrush(Theme.Alpha(Color.White, 10))) g.FillRectangle(track, 0, 38, W, 2);
            using (var line = new SolidBrush(Theme.Accent)) g.FillRectangle(line, 0, 38, W * progress, 2);
        };
        titleBar.MouseDown += (s, e) => { ReleaseCapture(); SendMessage(Handle, 0xA1, 2, 0); };
        var min = new IconButton("minus", 40) { Round = false, Location = new Point(W - 80, 0), Size = new Size(40, 40) };
        var close = new IconButton("x", 40) { Round = false, Location = new Point(W - 40, 0), Size = new Size(40, 40), HoverColor = Theme.Danger };
        min.Click += (s, e) => WindowState = FormWindowState.Minimized;
        close.Click += (s, e) => FadeOutAndClose();
        titleBar.Controls.Add(min); titleBar.Controls.Add(close);

        // bottom bar: round link buttons left, Back + primary right
        var tips = new ToolTip();
        var site = new IconButton("folder", 36) { Location = new Point(24, 392) };
        var code = new IconButton("code", 36) { Location = new Point(68, 392) };
        var heart = new IconButton("heart", 36) { Location = new Point(112, 392) };
        tips.SetToolTip(site, "Open the Lumicord folder"); tips.SetToolTip(code, "Open the plugins folder"); tips.SetToolTip(heart, "Credits");
        site.Click += (s, e) => { Directory.CreateDirectory(DataDir); Process.Start("explorer.exe", DataDir); };
        code.Click += (s, e) => { var p = Path.Combine(DataDir, "plugins"); Directory.CreateDirectory(p); Process.Start("explorer.exe", p); };
        heart.Click += (s, e) => MessageBox.Show(this, "Lumicord — a free, open source Discord client mod (GPL-3.0).\n\nIncludes Vencord (github.com/Vendicated/Vencord), GPL-3.0.\nMarketplace addons come from the public BetterDiscord catalog.", "Credits");

        back.Location = new Point(W - 24 - 96 - 10 - 96, 392); next.Location = new Point(W - 24 - 96, 392);
        back.Click += (s, e) => Show(step - 1);
        next.Click += (s, e) => { if (step == 3) FadeOutAndClose(); else Show(step + 1); };
        Controls.AddRange(new Control[] { titleBar, viewport, site, code, heart, back, next });

        Anim.Tick += () => {
            if (IsDisposed) return;
            if (Opacity < 1 && !closing) Opacity = Math.Min(1, Opacity + 0.1);
            progress = Anim.Step(progress, (step + 1) / 4f, 0.12f);
            if (++frame % 2 == 0) titleBar.Invalidate(); // the glow moves slowly: 30fps is plenty and halves the work
            if (body != null && slideStart >= 0) {
                float t = Math.Min(1, (Anim.Now - slideStart) / 0.25f);
                body.Left = (int)((1 - Theme.Ease(t)) * 24 * slideDir);
                if (t >= 1) slideStart = -1;
            }
        };
        Show(0);
    }

    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        int round = 2; try { DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { } // Windows 11 rounded corners
    }

    bool closing;
    void FadeOutAndClose() {
        // Closing mid-install would kill the worker between renaming app.asar and writing the loader.
        if (installing) { MessageBox.Show(this, "Please wait until the installer has finished.", "Lumicord"); return; }
        if (closing) return; closing = true;
        var t = new Timer { Interval = 16 };
        t.Tick += (s, e) => { Opacity -= 0.12; if (Opacity <= 0.05) { t.Stop(); Close(); } };
        t.Start();
    }

    void Show(int s) {
        slideDir = s >= step ? 1 : -1;
        step = s;
        if (body != null) { viewport.Controls.Remove(body); body.Dispose(); }
        body = new Canvas { Size = viewport.Size, BackColor = Theme.Bg, Left = 24 * slideDir };
        viewport.Controls.Add(body);
        slideStart = Anim.Now;
        back.Visible = s > 0 && s < 3; next.Text = "Next"; next.Enabled = true;
        if (s == 0) License(); else if (s == 1) Actions(); else if (s == 2) Channels(); else RunInstall();
    }

    // Title row: accent icon + bold title.
    Label Heading(string icon, string t) {
        var ic = new Canvas { Location = new Point(24, 14), Size = new Size(30, 30), BackColor = Theme.Bg };
        ic.Paint += (o, e) => Icons.Draw(e.Graphics, icon, new RectangleF(1, 1, 28, 28), Theme.Accent);
        var l = new Label { Text = t, Font = Theme.F(16, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(60, 13), AutoSize = true };
        body.Controls.Add(ic); body.Controls.Add(l); return l;
    }

    void License() {
        Heading("doc", "License Agreement");
        var frame = new Canvas { Location = new Point(24, 60), Size = new Size(612, 220), BackColor = Theme.Surface, Padding = new Padding(14) };
        frame.Paint += (o, e) => { using (var p = new Pen(Theme.Border)) e.Graphics.DrawRectangle(p, 0, 0, frame.Width - 1, frame.Height - 1); };
        var box = new TextBox {
            Multiline = true, ReadOnly = true, TabStop = false, ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.None,
            BackColor = Theme.Surface, ForeColor = Theme.Text, Font = Theme.F(9.5f), Dock = DockStyle.Fill,
            Text = "Lumicord is a free, open source Discord client mod, licensed under the GNU GPL v3.0.\r\n\r\n" +
                   "• Client mods are against Discord's Terms of Service. Your account could be limited or banned. Use at your own risk.\r\n\r\n" +
                   "• Plugins run with the same access as Discord itself. Only install plugins you trust.\r\n\r\n" +
                   "• Discord updates remove Lumicord. Run this installer again and choose Repair.\r\n\r\n" +
                   "• Lumicord includes Vencord (github.com/Vendicated/Vencord), also GPL-3.0.\r\n\r\n" +
                   "• Lumicord files are stored in " + DataDir + "\r\n\r\n" +
                   "This software is provided as is, without warranty of any kind."
        };
        frame.Controls.Add(box);
        DarkScrollbars(box);
        var agree = new Check("I accept the license agreement") { Location = new Point(24, 292) };
        next.Enabled = false; agree.Changed += (o, e) => next.Enabled = agree.Checked;
        body.Controls.Add(frame); body.Controls.Add(agree);
    }

    void Actions() {
        Heading("windowcheck", "Choose an Action");
        var opts = new[] {
            new { id = "install", row = new Row("download", "Install Lumicord", "Add Lumicord to your Discord", false) },
            new { id = "repair", row = new Row("repair", "Repair Lumicord", "Reinstall after a Discord update or if something broke", false) },
            new { id = "uninstall", row = new Row("trash", "Uninstall Lumicord", "Remove Lumicord from Discord. Your plugins and themes are kept", false) },
        };
        for (int i = 0; i < opts.Length; i++) {
            var o = opts[i]; o.row.Location = new Point(24, 60 + i * 78); o.row.Selected = action == o.id;
            o.row.Click += (x, e) => { action = o.id; foreach (var c in opts) c.row.Selected = c.id == action; next.Enabled = true; };
            body.Controls.Add(o.row);
        }
        next.Enabled = action != null;
    }

    void Channels() {
        Heading("windowcheck", "Choose Discord Versions");
        var rows = new List<Row>();
        for (int i = 0; i < Builds.GetLength(0); i++) {
            string folder = Builds[i, 0];
            string res = ResourcesFor(folder);
            var r = new Row("app", Builds[i, 1], res ?? "Not Found", true) { Location = new Point(24, 60 + i * 78), Found = res != null, Tag = folder, AppIcon = AppIconFor(folder, res) };
            r.Selected = channel == folder && res != null;
            r.Click += (x, e) => { if (!r.Found) return; channel = (string)r.Tag; foreach (var k in rows) k.Selected = k == r; next.Enabled = true; };
            r.Browse.Click += (x, e) => {
                using (var dlg = new FolderBrowserDialog { Description = "Select the " + Builds[rows.IndexOf(r), 1] + " folder (the one that contains app-* folders)" }) {
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    var picked = FindResourcesIn(dlg.SelectedPath);
                    if (picked == null) { MessageBox.Show(this, "That folder does not contain a Discord installation (no app-* folder with resources).", "Not a Discord folder"); return; }
                    customDirs[(string)r.Tag] = dlg.SelectedPath;
                    r.Sub = picked; r.Found = true; channel = (string)r.Tag; r.AppIcon = AppIconFor((string)r.Tag, picked);
                    foreach (var k in rows) k.Selected = k == r;
                    next.Enabled = true; r.Invalidate();
                }
            };
            // Browse stays clickable even for versions that were not found
            rows.Add(r); body.Controls.Add(r);

        }
        if (channel == null) { var first = rows.FirstOrDefault(k => k.Found); if (first != null) { channel = (string)first.Tag; first.Selected = true; } }
        var separate = new Check("Don't share plugins and themes with other Discord versions") { Location = new Point(24, 298), Size = new Size(460, 26) };
        separate.Changed += (o, e) => separateProfile = separate.Checked;
        if (separateProfile) separate.Toggle();
        body.Controls.Add(separate);
        next.Text = action == "uninstall" ? "Uninstall" : action == "repair" ? "Repair" : "Install";
        next.Enabled = channel != null;
    }

    void RunInstall() {
        var head = Heading("download", action == "uninstall" ? "Uninstalling" : action == "repair" ? "Repairing" : "Installing");
        var bar = new Bar { Location = new Point(24, 62), Target = 0.15f };
        var log = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BorderStyle = BorderStyle.None, BackColor = Theme.Surface, ForeColor = Theme.Muted, Font = new Font("Consolas", 9), Location = new Point(24, 82), Size = new Size(612, 236) };
        body.Controls.Add(bar); body.Controls.Add(log);
        DarkScrollbars(log);
        next.Enabled = false; next.Text = "Close";
        int lines = 0;
        Action<string> say = m => BeginInvoke((Action)(() => { log.AppendText(m + "\r\n"); lines++; bar.Target = Math.Min(0.92f, 0.15f + lines * 0.08f); }));
        string a = action, ch = channel, custom; bool sep = separateProfile;
        customDirs.TryGetValue(ch, out custom);
        installing = true;
        Task.Run(() => {
            bool ok = true;
            try { Work(a, ch, custom, sep, say); say(""); say(a == "uninstall" ? "Lumicord was removed." : "Done. Open Discord and find Lumicord in User Settings."); }
            catch (Exception ex) { ok = false; say(""); say("Failed: " + ex.Message); }
            BeginInvoke((Action)(() => {
                installing = false;
                bar.Busy = false; bar.Target = 1; if (!ok) bar.Fill = Theme.Danger;
                head.Text = ok ? (a == "uninstall" ? "Uninstalled" : "Installed") : "Something went wrong";
                next.Enabled = true;
            }));
        });
    }

    // ---------- install logic ----------
    string ResourcesFor(string folder) {
        string dir;
        return customDirs.TryGetValue(folder, out dir) ? FindResourcesIn(dir) : FindResourcesIn(Path.Combine(Local, folder));
    }

    // The real app icon, read from the installed Discord/PTB/Canary .exe (resources\..\<folder>.exe). null if not installed.
    static Image AppIconFor(string folder, string resources) {
        try {
            if (resources == null) return null;
            var exe = Path.Combine(Path.GetDirectoryName(resources), folder + ".exe");
            if (!File.Exists(exe)) return null;
            using (var ic = Icon.ExtractAssociatedIcon(exe)) return ic.ToBitmap();
        } catch { return null; }
    }

    // dir = a Discord install folder (contains app-x.y.z). Returns the newest version's resources folder.
    static string FindResourcesIn(string dir) {
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
        var app = Directory.GetDirectories(dir, "app-*")
            .Where(d => { Version v; return Version.TryParse(Path.GetFileName(d).Substring(4).Split('-')[0], out v); })
            .OrderBy(d => new Version(Path.GetFileName(d).Substring(4).Split('-')[0])).LastOrDefault();
        return app == null ? null : Path.Combine(app, "resources");
    }

    static void Work(string action, string folder, string customDir, bool separate, Action<string> say) {
        string res = FindResourcesIn(customDir ?? Path.Combine(Local, folder));
        if (res == null) throw new Exception("Discord not found.");
        say("Discord: " + res);

        var exe = folder + ".exe";
        var procs = Process.GetProcessesByName(folder);
        if (procs.Length > 0) { say("Closing " + folder + "…"); foreach (var p in procs) { try { p.Kill(); p.WaitForExit(5000); } catch { } } System.Threading.Thread.Sleep(1000); }

        string asar = Path.Combine(res, "app.asar"), orig = Path.Combine(res, "_app.asar"), appDir = Path.Combine(res, "app");
        if (action == "uninstall") {
            // Restore Discord's archive FIRST; only then remove the loader. If the restore fails, the loader still
            // points at _app.asar and Discord keeps working.
            if (File.Exists(orig)) { if (File.Exists(asar)) File.Delete(asar); File.Move(orig, asar); say("Restored app.asar"); }
            if (Directory.Exists(appDir)) { Directory.Delete(appDir, true); say("Removed loader"); }
        } else {
            ExtractFiles(say);
            // Discord repaired/replaced its own app.asar while ours is still around: the new one is the real one.
            if (File.Exists(orig) && File.Exists(asar)) { File.Delete(orig); say("Replacing outdated _app.asar"); }
            if (!File.Exists(orig) && !File.Exists(asar)) throw new Exception("app.asar not found");
            // Write the loader BEFORE renaming, and undo the loader if the rename fails: at every moment either
            // app.asar or (loader + _app.asar) exists, so Discord can always start.
            Directory.CreateDirectory(appDir);
            try {
                File.WriteAllText(Path.Combine(appDir, "package.json"), "{\"name\":\"discord\",\"main\":\"index.js\"}");
                var patcher = Path.Combine(DataDir, "src", "patcher.js").Replace("\\", "\\\\");
                // "don't share": tell Lumicord which Discord version this is, so it uses profiles\<folder> for addons
                var profileLine = separate ? "process.env.LUMICORD_PROFILE = \"" + folder + "\";\n" : "";
                File.WriteAllText(Path.Combine(appDir, "index.js"), profileLine + "require(\"" + patcher + "\");\n");
                say(separate ? "Wrote loader (separate plugins and themes for " + folder + ")" : "Wrote loader");
                if (!File.Exists(orig)) { File.Move(asar, orig); say("Renamed app.asar -> _app.asar"); }
            } catch {
                if (!File.Exists(orig)) try { Directory.Delete(appDir, true); } catch { }
                throw;
            }
        }

        var update = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(res)), "Update.exe");
        if (File.Exists(update)) { say("Starting Discord…"); Process.Start(update, "--processStart " + exe); }
    }

    // Copies the bundled Lumicord files to %APPDATA%\Lumicord. Code is always updated; the user's theme and plugins are kept.
    static void ExtractFiles(Action<string> say) {
        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in asm.GetManifestResourceNames().Where(n => n.StartsWith("files/"))) {
            var rel = name.Substring(6).Replace('/', Path.DirectorySeparatorChar);
            var dest = Path.Combine(DataDir, rel);
            if (!rel.StartsWith("src") && !rel.StartsWith("vencord") && rel != "version.json" && File.Exists(dest)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            using (var s = asm.GetManifestResourceStream(name)) using (var f = File.Create(dest)) s.CopyTo(f);
            say("Copied " + rel);
        }
    }

    [STAThread]
    static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Wizard());
    }
}
