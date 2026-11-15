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
    // Layout and type tokens keep the compact wizard aligned on one grid.
    public const int S4 = 4, S8 = 8, S12 = 12, S16 = 16, S24 = 24;
    public const int Radius = 8, SmallRadius = 6;
    public const float TypeCaption = 9.5f, TypeBody = 10.5f, TypeTitle = 16f;
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
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit; // grid-fit: sharp glyph edges, no ClearType fringes
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
                case "check":
                    g.DrawLines(pen, new[] { new PointF(x + s * .18f, cy), new PointF(x + s * .42f, y + s * .73f), new PointF(x + s * .84f, y + s * .26f) });
                    break;
                case "shield":
                    using (var p = new GraphicsPath()) { p.AddLines(new[] { new PointF(cx, y + s*.1f), new PointF(x+s*.8f,y+s*.25f), new PointF(x+s*.72f,y+s*.68f), new PointF(cx,y+s*.9f), new PointF(x+s*.28f,y+s*.68f), new PointF(x+s*.2f,y+s*.25f), new PointF(cx,y+s*.1f) }); g.DrawPath(pen,p); }
                    break;
                case "store":
                    using (var p = Theme.Round(new RectangleF(x+s*.16f,y+s*.35f,s*.68f,s*.48f), s*.07f)) g.DrawPath(pen,p);
                    g.DrawLine(pen,x+s*.12f,y+s*.35f,x+s*.88f,y+s*.35f); g.DrawLine(pen,x+s*.25f,y+s*.18f,x+s*.36f,y+s*.35f); g.DrawLine(pen,x+s*.75f,y+s*.18f,x+s*.64f,y+s*.35f);
                    break;
                case "puzzle":
                    using (var p = Theme.Round(new RectangleF(x+s*.18f,y+s*.18f,s*.64f,s*.64f), s*.1f)) g.DrawPath(pen,p);
                    g.DrawLine(pen,cx,y+s*.2f,cx,y+s*.8f); g.DrawLine(pen,x+s*.2f,cy,x+s*.8f,cy);
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
    protected float hover, press;
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
        float p = Anim.Step(press, Capture && MouseButtons == MouseButtons.Left ? 1 : 0, 0.32f);
        if (t != hover || p != press || animating) { hover = t; press = p; Invalidate(); }
    }
    protected virtual bool Animating { get { return false; } }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
    protected void FocusRing(Graphics g, RectangleF r, float radius) {
        if (!Focused || !ShowFocusCues) return;
        using (var p = Theme.Round(RectangleF.Inflate(r, -1, -1), radius))
        using (var pen = new Pen(Theme.Accent, 2)) g.DrawPath(pen, p);
    }
    protected override void Dispose(bool d) { Anim.Tick -= OnTick; base.Dispose(d); }
}

// Buttons: Primary (accent fill), Outline (border only), Light (white fill, accent text).
enum BtnStyle { Primary, Outline, Light }
class FlatButton : AnimControl {
    public BtnStyle Style;
    public FlatButton(string text, BtnStyle style = BtnStyle.Primary) { Text = text; Style = style; Font = Theme.F(10.5f); Size = new Size(96, 38); }
    public void InvokeClick() { OnClick(EventArgs.Empty); }
    protected override void OnPaint(PaintEventArgs e) {
        // Clear with our own BackColor (set by the row behind us), not Parent.BackColor: the Row control's own
        // BackColor is the window color, which left black corners around Browse on the pink selected row.
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(BackColor);
        var r = new RectangleF(0.5f + press, 0.5f + press, Width - 1.5f - press * 2, Height - 1.5f - press * 2);
        Color fill, fg, border;
        if (!Enabled) { fill = Theme.Surface; fg = Theme.Muted; border = Theme.Border; }
        else if (Style == BtnStyle.Primary) { fill = Theme.Mix(Theme.Accent, Color.White, hover * 0.1f); fg = Color.White; border = fill; }
        else if (Style == BtnStyle.Light) { fill = Theme.Mix(Color.White, Theme.Text, hover); fg = Theme.Accent; border = fill; }
        else { fill = Theme.Mix(BackColor, Theme.SurfaceHover, hover); fg = Theme.Text; border = Theme.Border; }
        using (var p = Theme.Round(r, Theme.SmallRadius)) {
            using (var b = new SolidBrush(fill)) g.FillPath(b, p);
            using (var pen = new Pen(border)) g.DrawPath(pen, p);
        }
        Theme.Draw(g, Text, Font, ClientRectangle, fg, StringAlignment.Center, StringAlignment.Center);
        FocusRing(g, new RectangleF(0, 0, Width - 1, Height - 1), Theme.SmallRadius);
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
        float s = Width * 0.5f;
        Icons.Draw(g, Icon, new RectangleF((Width - s) / 2, (Height - s) / 2, s, s), Theme.Mix(Theme.Muted, Theme.Text, hover));
        if (Focused && ShowFocusCues) using (var pen = new Pen(Theme.Accent, 2)) g.DrawEllipse(pen, 1, 1, Width - 3, Height - 3);
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
    Color BackColorNow { get { return Theme.Mix(Theme.Mix(Theme.Surface, Theme.SurfaceHover, Found ? hover : 0), Theme.Alpha(Theme.Accent, 42), sel); } }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        var back = BackColorNow;
        using (var p = Theme.Round(new RectangleF(0, 0, Width - 1, Height - 1), 6)) {
            using (var b = new SolidBrush(back)) g.FillPath(b, p);
            using (var pen = new Pen(Selected ? Theme.Accent : Theme.Mix(Theme.Border, Theme.Muted, hover * .35f))) g.DrawPath(pen, p);
        }
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
            Icons.Draw(g, Icon, new RectangleF(24, 22, 20, 20), Icon == "trash" ? Theme.Danger : (Found ? Theme.Mix(Theme.Muted, Theme.Accent, sel) : Theme.Muted));
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

// Flat progress bar; easing stops repainting once it reaches its target.
class Bar : AnimControl {
    public float Target = 0; float v; public bool Busy = true; public Color Fill = Theme.Accent;
    public Bar() { Cursor = Cursors.Default; Size = new Size(612, 6); }
    protected override bool Animating { get { float n = Anim.Step(v, Target, 0.08f); bool ch = n != v; v = n; return ch; } }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        using (var p = Theme.Round(new RectangleF(0, 0, Width - 1, Height - 1), 3)) using (var b = new SolidBrush(Theme.Surface)) g.FillPath(b, p);
        float w = Math.Max(Height, (Width - 1) * v);
        using (var p = Theme.Round(new RectangleF(0, 0, w, Height - 1), 3)) {
            using (var b = new SolidBrush(Fill)) g.FillPath(b, p);
        }
    }
}

// Quiet, flat progress/status mark used by the final screen.
class StatusRing : AnimControl {
    public bool Working = true, Success = true; float spin;
    public StatusRing() { Size = new Size(82, 82); Cursor = Cursors.Default; }
    protected override bool Animating { get { if (Working) { spin += .055f; if (spin > 1) spin -= 1; return true; } return false; } }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        var r = new RectangleF(7, 7, Width - 14, Height - 14); Color c = Success ? Theme.Accent : Theme.Danger;
        using (var p = new Pen(Theme.Border, 5)) g.DrawEllipse(p, r);
        using (var p = new Pen(c, 5) { StartCap = LineCap.Round, EndCap = LineCap.Round }) {
            if (Working) g.DrawArc(p, r, spin * 360, 105);
            else if (Success) g.DrawLines(p, new[] { new PointF(24, 42), new PointF(35, 53), new PointF(59, 29) });
            else { g.DrawLine(p, 28, 28, 54, 54); g.DrawLine(p, 54, 28, 28, 54); }
        }
    }
}

class Canvas : Panel { public Canvas() { DoubleBuffered = true; SetStyle(ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint | ControlStyles.SupportsTransparentBackColor, true); } }

// Small in-window replacement for ToolTip: no native chrome, delayed and softly faded.
class InWindowTip : Canvas {
    readonly Control owner; readonly string text; float a; float entered = -1;
    public InWindowTip(Control owner, string text) {
        this.owner = owner; this.text = text; Size = new Size(Math.Max(88, TextRenderer.MeasureText(text, Theme.F(9.5f)).Width + 20), 28);
        BackColor = Color.Transparent; Enabled = false; Visible = false;
        owner.MouseEnter += (s, e) => { entered = Anim.Now; Visible = true; };
        owner.MouseLeave += (s, e) => entered = -1;
        Anim.Tick += Tick;
    }
    void Tick() {
        if (IsDisposed) { Anim.Tick -= Tick; return; }
        bool show = entered >= 0 && Anim.Now - entered > .4f;
        float n = Anim.Step(a, show ? 1 : 0, .22f);
        if (n != a) { a = n; Invalidate(); }
        if (!show && a <= .002f) Visible = false;
        if (Visible && owner.Parent != null) { Point p = owner.Parent.PointToClient(owner.PointToScreen(new Point((owner.Width - Width) / 2, owner.Height + 7))); Location = p; BringToFront(); }
    }
    protected override void OnPaint(PaintEventArgs e) {
        if (a <= 0) return; var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        using (var p = Theme.Round(r, Theme.SmallRadius)) using (var b = new SolidBrush(Theme.Alpha(Theme.Surface, (int)(250 * a)))) g.FillPath(b, p);
        using (var p = Theme.Round(r, Theme.SmallRadius)) using (var pen = new Pen(Theme.Alpha(Theme.Border, (int)(255 * a)))) g.DrawPath(pen, p);
        Theme.Draw(g, text, Theme.F(9.5f), ClientRectangle, Theme.Alpha(Theme.Text, (int)(255 * a)), StringAlignment.Center, StringAlignment.Center);
    }
}

// Modal notice used for validation and the close-during-install guard.
class Notice : Canvas {
    readonly string title, message, button; readonly Action done; float t;
    public Notice(string title, string message, string button, Action done) {
        this.title = title; this.message = message; this.button = button; this.done = done;
        BackColor = Theme.Bg; TabStop = true;
        var ok = new FlatButton(button, BtnStyle.Primary) { Size = new Size(92, 36), Location = new Point(414, 246), BackColor = Theme.Surface };
        ok.Click += (s, e) => done(); Controls.Add(ok); AcceptButton = ok;
        Anim.Tick += Tick;
    }
    FlatButton AcceptButton;
    void Tick() { if (IsDisposed) { Anim.Tick -= Tick; return; } float n = Anim.Step(t, 1, .2f); if (n != t) { t = n; Invalidate(); } }
    protected override bool ProcessDialogKey(Keys keyData) { if ((keyData & Keys.KeyCode) == Keys.Escape || (keyData & Keys.KeyCode) == Keys.Enter) { AcceptButton.InvokeClick(); return true; } return base.ProcessDialogKey(keyData); }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var shade = new SolidBrush(Theme.Alpha(Theme.Bg, 205))) g.FillRectangle(shade, ClientRectangle);
        float s = .96f + .04f * Theme.Ease(t), w = 460 * s, h = 190 * s, x = (Width - w) / 2, y = (Height - h) / 2 - 8;
        var card = new RectangleF(x, y, w, h);
        using (var p = Theme.Round(card, Theme.Radius)) using (var b = new SolidBrush(Theme.Surface)) g.FillPath(b, p);
        using (var p = Theme.Round(card, Theme.Radius)) using (var pen = new Pen(Theme.Border)) g.DrawPath(pen, p);
        Theme.Draw(g, title, Theme.F(14, FontStyle.Bold), new RectangleF(x + 24, y + 22, w - 48, 28), Theme.Text);
        Theme.Draw(g, message, Theme.F(10), new RectangleF(x + 24, y + 60, w - 48, 54), Theme.Muted, StringAlignment.Near, StringAlignment.Near, true);
        AcceptButton.Location = new Point((int)(x + w - 116), (int)(y + h - 54)); AcceptButton.BringToFront();
    }
}

// Display-only multiline text: no selection (mouse clicks/drags are ignored, so no blue highlight, no caret),
// and the mouse wheel scrolls it (a TextBox with its scrollbar hidden does not react to the wheel by itself).
class ReadOnlyText : TextBox {
    [DllImport("user32.dll")] static extern int SendMessage(IntPtr h, int msg, int w, int l);
    const int WM_SETFOCUS = 0x07, WM_MOUSEWHEEL = 0x20A, EM_LINESCROLL = 0xB6;
    public ReadOnlyText() { Multiline = true; ReadOnly = true; TabStop = false; ScrollBars = ScrollBars.None; BorderStyle = BorderStyle.None; Cursor = Cursors.Default; }
    protected override void WndProc(ref Message m) {
        int msg = m.Msg;
        if (msg >= 0x201 && msg <= 0x209) return; // left/right/middle button down, up, double-click: no selecting
        if (msg == WM_SETFOCUS) return;           // never take focus, so no caret and no keyboard selection
        if (msg == WM_MOUSEWHEEL) {
            int delta = (short)((long)m.WParam >> 16);
            SendMessage(Handle, EM_LINESCROLL, 0, -Math.Sign(delta) * 3);
            return;
        }
        base.WndProc(ref m);
    }
}

// Thin custom scrollbar for a multiline TextBox (whose own scrollbar is hidden): dark track, rounded pink thumb.
// Reads the box's position with EM_GETFIRSTVISIBLELINE / EM_GETLINECOUNT and scrolls it with EM_LINESCROLL.
class SlimScroll : AnimControl {
    [DllImport("user32.dll")] static extern int SendMessage(IntPtr h, int msg, int w, int l);
    const int EM_GETFIRSTVISIBLELINE = 0xCE, EM_GETLINECOUNT = 0xBA, EM_LINESCROLL = 0xB6;
    readonly TextBox box;
    int first, total, visible; bool dragging; float dragOffset;
    public SlimScroll(TextBox target) {
        box = target; Cursor = Cursors.Default;
        box.MouseWheel += (s, e) => Invalidate();
    }
    protected override bool Animating {
        get {
            if (!box.IsHandleCreated) return false;
            int f = SendMessage(box.Handle, EM_GETFIRSTVISIBLELINE, 0, 0);
            int t = SendMessage(box.Handle, EM_GETLINECOUNT, 0, 0);
            int v = Math.Max(1, box.ClientSize.Height / Math.Max(1, box.Font.Height));
            bool changed = f != first || t != total || v != visible;
            first = f; total = t; visible = v;
            return changed || dragging;
        }
    }
    int MaxFirst { get { return Math.Max(0, total - visible); } }
    RectangleF Thumb {
        get {
            if (total <= visible) return RectangleF.Empty;
            float h = Math.Max(28, Height * (float)visible / total);
            float y = (Height - h) * Math.Min(1f, first / (float)Math.Max(1, MaxFirst));
            return new RectangleF(1, y, Width - 2, h);
        }
    }
    void ScrollTo(int line) {
        line = Math.Max(0, Math.Min(MaxFirst, line));
        if (line != first) SendMessage(box.Handle, EM_LINESCROLL, 0, line - first);
    }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent.BackColor);
        var thumb = Thumb;
        if (thumb.IsEmpty) return; // nothing to scroll: no bar at all
        float r = (Width - 2) / 2f;
        using (var p = Theme.Round(new RectangleF(1, 0, Width - 2, Height - 1), r)) using (var b = new SolidBrush(Theme.Alpha(Color.White, 14))) g.FillPath(b, p);
        var col = dragging ? Theme.Accent : Theme.Mix(Theme.Alpha(Theme.Accent, 150), Theme.Accent, hover);
        using (var p = Theme.Round(thumb, r)) using (var b = new SolidBrush(col)) g.FillPath(b, p);
    }
    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        var thumb = Thumb; if (thumb.IsEmpty) return;
        if (thumb.Contains(e.Location)) { dragging = true; dragOffset = e.Y - thumb.Y; Capture = true; }
        else ScrollTo(first + (e.Y < thumb.Y ? -visible : visible)); // click on the track: page up/down
    }
    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e);
        if (!dragging) return;
        var thumb = Thumb; if (thumb.IsEmpty) return;
        float range = Math.Max(1, Height - thumb.Height);
        ScrollTo((int)Math.Round((e.Y - dragOffset) / range * MaxFirst));
    }
    protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); dragging = false; Capture = false; Invalidate(); }
    protected override void OnMouseWheel(MouseEventArgs e) { base.OnMouseWheel(e); ScrollTo(first - Math.Sign(e.Delta) * 3); }
}

class Wizard : Form {
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern int SendMessage(IntPtr h, int msg, int w, int l);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);

    const int W = 820, H = 520, Side = 220, Header = 44, Foot = 68;
    int step;
    string action, channel;
    readonly Dictionary<string, string> customDirs = new Dictionary<string, string>(); // channel -> folder picked with Browse
    readonly Canvas titleBar = new Canvas { Location = new Point(0, 0), Size = new Size(W, Header), BackColor = Theme.Bg };
    readonly Canvas sidebar = new Canvas { Location = new Point(0, Header), Size = new Size(Side, H - Header), BackColor = Theme.Surface };
    readonly Canvas viewport = new Canvas { Location = new Point(Side, Header), Size = new Size(W - Side, H - Header - Foot), BackColor = Theme.Bg };
    Canvas body;
    float slideStart = -1; int slideDir = 1;
    float progress; // title-bar progress line (0..1)
    Bitmap logo;               // the app icon, drawn small in the title bar
    Bitmap logoBig;            // 512px source (bundled logo.png) for sharp large renders
    // Downscale once with high-quality filtering; drawing a big bitmap small every frame (or a small one big) blurs.
    static Bitmap Scaled(Image src, int size) {
        var b = new Bitmap(size, size);
        using (var g = Graphics.FromImage(b)) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.SmoothingMode = SmoothingMode.AntiAlias; g.DrawImage(src, 0, 0, size, size); }
        return b;
    }
    readonly Dictionary<int, Bitmap> logoSizes = new Dictionary<int, Bitmap>();
    Bitmap LogoAt(int size) { Bitmap b; if (!logoSizes.TryGetValue(size, out b)) logoSizes[size] = b = Scaled((Image)logoBig ?? logo, size); return b; }
    bool installing;           // closing is blocked while files are being changed
    bool separateProfile;      // "don't share": this Discord version gets its own plugins/themes/settings
    readonly FlatButton back = new FlatButton("Back", BtnStyle.Outline);
    readonly FlatButton next = new FlatButton("Next");
    IconButton site, code, heart;

    static readonly string[,] Builds = { { "Discord", "Discord" }, { "DiscordPTB", "Discord PTB" }, { "DiscordCanary", "Discord Canary" } };
    static string Local { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
    static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Lumicord"); } }

    protected override CreateParams CreateParams { get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; } } // drop shadow

    public Wizard() {
        Text = "Lumicord Installer"; FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(W, H); BackColor = Theme.Bg; ForeColor = Theme.Text; DoubleBuffered = true; Opacity = 0;
        // our own exe (not Application.ExecutablePath, which is the host process when the form is hosted elsewhere)
        try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); logo = new Icon(Icon, 32, 32).ToBitmap(); } catch { }
        try { using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png")) if (st != null) { logoBig = new Bitmap(st); if (logo != null) logo.Dispose(); logo = Scaled(logoBig, 64); } } catch { }

        // Restrained chrome; navigation and actions live in the two-column layout below.
        titleBar.Paint += (s, e) => {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            if (logo != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImageUnscaled(LogoAt(20), 14, 10); }
            else Icons.Draw(g, "sparkle", new RectangleF(16, 11, 18, 18), Theme.Accent);
            using (var line = new SolidBrush(Theme.Border)) g.FillRectangle(line, 0, Header - 1, W, 1);
        };
        titleBar.MouseDown += (s, e) => { ReleaseCapture(); SendMessage(Handle, 0xA1, 2, 0); };
        var min = new IconButton("minus", 40) { Round = false, Location = new Point(W - 80, 0), Size = new Size(40, Header) };
        var close = new IconButton("x", 40) { Round = false, Location = new Point(W - 40, 0), Size = new Size(40, Header), HoverColor = Theme.Danger };
        min.Click += (s, e) => WindowState = FormWindowState.Minimized;
        close.Click += (s, e) => FadeOutAndClose();
        titleBar.Controls.Add(min); titleBar.Controls.Add(close);

        sidebar.Paint += DrawSidebar;
        // Utility destinations are deliberately attached to the rail, not the workflow footer.
        site = new IconButton("folder", 42) { Location = new Point(20, sidebar.Height - 62) };
        code = new IconButton("code", 42) { Location = new Point(72, sidebar.Height - 62) };
        heart = new IconButton("heart", 42) { Location = new Point(124, sidebar.Height - 62) };
        site.Click += (s, e) => { Directory.CreateDirectory(DataDir); Process.Start("explorer.exe", DataDir); };
        code.Click += (s, e) => { var p = Path.Combine(DataDir, "plugins"); Directory.CreateDirectory(p); Process.Start("explorer.exe", p); };
        heart.Click += (s, e) => ToggleCredits();

        back.Location = new Point(W - 24 - 96 - 10 - 96, H - 50); next.Location = new Point(W - 24 - 96, H - 50);
        back.Click += (s, e) => Show(step - 1);
        next.Click += (s, e) => { if (step == 4) FadeOutAndClose(); else Show(step + 1); };
        sidebar.Controls.AddRange(new Control[] { site, code, heart });
        Controls.AddRange(new Control[] { titleBar, sidebar, viewport, back, next });
        sidebar.Controls.Add(new InWindowTip(site, "Open Lumicord folder"));
        sidebar.Controls.Add(new InWindowTip(code, "Open plugins folder"));
        sidebar.Controls.Add(new InWindowTip(heart, "Credits"));

        Anim.Tick += OnAnimationTick;
        Show(0);
    }

    void OnAnimationTick() {
            if (IsDisposed) return;
            if (Opacity < 1 && !closing) Opacity = Math.Min(1, Opacity + 0.1);
            float n = Anim.Step(progress, step, 0.16f);
            if (n != progress) { progress = n; sidebar.Invalidate(); }
            if (body != null && slideStart >= 0) {
                float t = Math.Min(1, (Anim.Now - slideStart) / 0.25f);
                body.Left = (int)((1 - Theme.Ease(t)) * 24 * slideDir);
                if (t >= 1) slideStart = -1;
            }
    }
    protected override void Dispose(bool disposing) { Anim.Tick -= OnAnimationTick; if (logo != null) logo.Dispose(); base.Dispose(disposing); }

    void DrawSidebar(object sender, PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var edge = new Pen(Theme.Border)) g.DrawLine(edge, Side - 1, 0, Side - 1, sidebar.Height);
        if (logo != null) { g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImageUnscaled(LogoAt(30), 20, 18); }
        else Icons.Draw(g, "sparkle", new RectangleF(22, 20, 26, 26), Theme.Accent);
        Theme.Draw(g, "Lumicord", Theme.F(14, FontStyle.Bold), new RectangleF(62, 18, 130, 22), Theme.Text);
        Theme.Draw(g, "Installer", Theme.F(9), new RectangleF(63, 40, 120, 16), Theme.Muted);
        string[] names = { "Welcome", "License", "Action", "Discord version", "Install" };
        string[] ico = { "sparkle", "doc", "windowcheck", "app", "download" };
        float markerY = 92 + progress * 48;
        using (var b = new SolidBrush(Theme.Accent)) g.FillRectangle(b, 0, markerY, 3, 30);
        for (int i = 0; i < names.Length; i++) {
            float y = 92 + i * 48; bool current = i == step && !installDone, done = i < step || (i == step && installDone);
            Color c = current ? Theme.Accent : done ? Theme.Accent : Theme.Muted;
            if (done) { using (var b = new SolidBrush(Theme.Accent)) g.FillEllipse(b, 20, y + 6, 18, 18); Icons.Draw(g, "check", new RectangleF(23, y + 9, 12, 12), Color.White); }
            else { using (var p = Theme.Round(new RectangleF(20, y + 6, 18, 18), 5)) using (var pen = new Pen(current ? Theme.Accent : Theme.Border)) g.DrawPath(pen, p); Icons.Draw(g, ico[i], new RectangleF(24, y + 10, 10, 10), c); }
            Theme.Draw(g, names[i], Theme.F(10.5f, current ? FontStyle.Bold : FontStyle.Regular), new RectangleF(50, y + 4, 145, 24), current ? Theme.Text : (done ? Theme.Text : Theme.Muted), StringAlignment.Near, StringAlignment.Center);
        }
        using (var p = new Pen(Theme.Border)) g.DrawLine(p, 20, sidebar.Height - 78, Side - 20, sidebar.Height - 78);
    }

    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        int round = 2; try { DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { } // Windows 11 rounded corners
    }

    bool closing;
    void FadeOutAndClose() {
        // Closing mid-install would kill the worker between renaming app.asar and writing the loader.
        if (installing) { ShowNotice("Please wait", "The installer is still changing Discord files. You can close it as soon as it finishes."); return; }
        if (closing) return; closing = true;
        var t = new Timer { Interval = 16 };
        t.Tick += (s, e) => { Opacity -= 0.12; if (Opacity <= 0.05) { t.Stop(); Close(); } };
        t.Start();
    }

    void ShowNotice(string title, string message) {
        Notice n = null;
        n = new Notice(title, message, "OK", () => { viewport.Controls.Remove(n); n.Dispose(); Activate(); });
        n.Bounds = viewport.ClientRectangle;
        viewport.Controls.Add(n); viewport.Controls.SetChildIndex(n, 0); n.BringToFront(); n.Show(); n.Focus();
    }

    void Show(int s) {
        slideDir = s >= step ? 1 : -1;
        step = s;
        if (body != null) { viewport.Controls.Remove(body); body.Dispose(); }
        body = new Canvas { Size = viewport.Size, BackColor = Theme.Bg, Left = 12 * slideDir };
        viewport.Controls.Add(body);
        slideStart = Anim.Now;
        back.Visible = s > 0 && s < 4; next.Text = s == 0 ? "Get started" : "Next"; next.Enabled = true;
        if (s == 0) Welcome(); else if (s == 1) License(); else if (s == 2) Actions(); else if (s == 3) Channels(); else RunInstall();
    }

    // Title row: accent icon + bold title.
    bool installDone; // the Install step gets its check once it finished successfully
    Label Heading(string icon, string t) {
        var l = new Label { Text = t, Font = Theme.F(17, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(32, 22), Size = new Size(520, 34), AutoSize = false, BackColor = Theme.Bg };
        body.Controls.Add(l); return l;
    }
    void Subheading(string text) { body.Controls.Add(new Label { Text = text, Font = Theme.F(10), ForeColor = Theme.Muted, Location = new Point(33, 58), AutoSize = true }); }
    void Welcome() {
        if (logo != null) body.Controls.Add(new PictureBox { Image = LogoAt(64), Location = new Point(32, 92), Size = new Size(64, 64), SizeMode = PictureBoxSizeMode.Normal });
        else { var mark = new Canvas { Location = new Point(32,94), Size = new Size(62,62), BackColor = Theme.Bg }; mark.Paint += (o,e) => Icons.Draw(e.Graphics,"sparkle",new RectangleF(8,8,46,46),Theme.Accent); body.Controls.Add(mark); }
        var title = new Label { Text = "Welcome to Lumicord", Font = Theme.F(21, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(30, 166), AutoSize = true }; body.Controls.Add(title);
        body.Controls.Add(new Label { Text = "A better Discord experience, made simple.", Font = Theme.F(11), ForeColor = Theme.Muted, Location = new Point(33, 212), AutoSize = true });
        string[] text = { "BetterDiscord plugins & themes", "Built-in Marketplace", "Signed automatic updates" }; string[] icon = { "puzzle", "store", "shield" };
        for (int i=0;i<3;i++) { int y=254+i*34; var row = new Canvas { Location=new Point(32,y), Size=new Size(360,28), BackColor=Theme.Bg }; int n=i; row.Paint += (o,e) => { Icons.Draw(e.Graphics,icon[n],new RectangleF(2,5,18,18),Theme.Accent); Theme.Draw(e.Graphics,text[n],Theme.F(10.5f),new RectangleF(32,1,310,26),Theme.Text,StringAlignment.Near,StringAlignment.Center); }; body.Controls.Add(row); }
    }

    // Credits: an in-window panel over the current step (not a Windows message box), with clickable links.
    Canvas credits;
    void ToggleCredits() {
        if (credits != null) { viewport.Controls.Remove(credits); credits.Dispose(); credits = null; return; }
        credits = new Canvas { Location = new Point(0, 0), Size = viewport.Size, BackColor = Theme.Bg, Visible = true };
        credits.Paint += (o, e) => {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            Theme.Draw(g, "Credits", Theme.F(16, FontStyle.Bold), new RectangleF(24, 13, 220, 30), Theme.Text);
            Theme.Draw(g, "Lumicord is built on these open source projects. Thank you!", Theme.F(9.5f), new RectangleF(26, 48, 500, 20), Theme.Muted);
            string[] names = { "Vencord", "BetterDiscord" };
            string[] descriptions = { "Lumicord ships Vencord and its plugins.", "Lumicord runs BetterDiscord plugins and themes through its own BdApi." };
            for (int i = 0; i < 2; i++) {
                float y0 = 80 + i * 108;
                using (var p = Theme.Round(new RectangleF(32, y0, 536, 96), Theme.Radius)) using (var b = new SolidBrush(Theme.Surface)) g.FillPath(b, p);
                using (var p = Theme.Round(new RectangleF(32.5f, y0 + .5f, 535, 95), Theme.Radius)) using (var pen = new Pen(Theme.Border)) g.DrawPath(pen, p);
                Theme.Draw(g, names[i], Theme.F(11.5f, FontStyle.Bold), new RectangleF(38, y0 + 10, 260, 20), Theme.Text);
                Theme.Draw(g, descriptions[i], Theme.F(9), new RectangleF(38, y0 + 36, 540, 18), Theme.Muted);
                Theme.Draw(g, i == 0 ? "By Vendicated  ·  GitHub  ·  GPL-3.0" : "By Jiiks, Zerebos and contributors  ·  GitHub  ·  Apache-2.0", Theme.F(9.5f), new RectangleF(38, y0 + 64, 520, 18), Theme.Accent);
            }
            Theme.Draw(g, "Lumicord is not affiliated with Vencord, BetterDiscord or Discord.", Theme.F(8.5f), new RectangleF(26, 298, 520, 18), Theme.Muted);
        };
        credits.Controls.Add(new Label { Text = "Credits", Font = Theme.F(16, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(24, 13), AutoSize = true });
        var closeCredits = new FlatButton("Close", BtnStyle.Outline) { Location = new Point(472, 12), Size = new Size(96, 32), BackColor = Theme.Bg };
        closeCredits.Click += (s, e) => ToggleCredits(); credits.Controls.Add(closeCredits);
        credits.Controls.Add(new Label { Text = "Lumicord is built on these open source projects. Thank you!", Font = Theme.F(9.5f), ForeColor = Theme.Muted, Location = new Point(26, 48), AutoSize = true });
        int y = 80;
        Action<string, string[,], string, string, string> card = (name, by, repo, license, what) => {
            var c = new Canvas { Location = new Point(32, y), Size = new Size(536, 96), BackColor = Theme.Surface };
            c.Paint += (o, e) => { using (var pen = new Pen(Theme.Border)) e.Graphics.DrawRectangle(pen, 0, 0, c.Width - 1, c.Height - 1); };
            c.Controls.Add(new Label { Text = name, Font = Theme.F(11.5f, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(14, 10), AutoSize = true, BackColor = Theme.Surface });
            c.Controls.Add(new Label { Text = what, Font = Theme.F(9), ForeColor = Theme.Muted, Location = new Point(14, 36), AutoSize = true, BackColor = Theme.Surface });
            // one LinkLabel with several link ranges, so commas and dots sit tight against the names
            var line = new LinkLabel { Font = Theme.F(9.5f), AutoSize = true, ForeColor = Theme.Muted, LinkColor = Theme.Accent, ActiveLinkColor = Theme.Text,
                LinkBehavior = LinkBehavior.HoverUnderline, BackColor = Theme.Surface, Location = new Point(12, 64) };
            var text = "By "; var ranges = new List<Tuple<int, int, string>>();
            for (int i = 0; i < by.GetLength(0); i++) {
                if (i > 0) text += i == by.GetLength(0) - 1 ? " and " : ", ";
                ranges.Add(Tuple.Create(text.Length, by[i, 0].Length, by[i, 1])); text += by[i, 0];
            }
            text += "  ·  "; ranges.Add(Tuple.Create(text.Length, 6, repo)); text += "GitHub  ·  " + license;
            line.Text = text; line.Links.Clear();
            foreach (var rg in ranges) line.Links.Add(rg.Item1, rg.Item2, rg.Item3);
            line.LinkClicked += (o, e) => Process.Start((string)e.Link.LinkData);
            var links = line;
            c.Controls.Add(links); credits.Controls.Add(c); y += 108;
        };
        card("Vencord", new[,] { { "Vendicated", "https://github.com/Vendicated" } }, "https://github.com/Vendicated/Vencord", "GPL-3.0", "Lumicord ships Vencord and its plugins.");
        card("BetterDiscord", new[,] { { "Jiiks", "https://github.com/Jiiks" }, { "Zerebos", "https://github.com/zerebos" }, { "contributors", "https://github.com/BetterDiscord/BetterDiscord/graphs/contributors" } },
             "https://github.com/BetterDiscord/BetterDiscord", "Apache-2.0", "Lumicord runs BetterDiscord plugins and themes through its own BdApi.");
        credits.Controls.Add(new Label { Text = "Lumicord is not affiliated with Vencord, BetterDiscord or Discord.", Font = Theme.F(8.5f), ForeColor = Theme.Muted, Location = new Point(26, y + 2), AutoSize = true });
        viewport.Controls.Add(credits); viewport.Controls.SetChildIndex(credits, 0); credits.BringToFront(); credits.Show();
    }

    void License() {
        Heading("doc", "License agreement"); Subheading("Please review the terms before continuing.");
        var frame = new Canvas { Location = new Point(32, 92), Size = new Size(536, 236), BackColor = Theme.Surface, Padding = new Padding(14) };
        frame.Paint += (o, e) => { using (var p = new Pen(Theme.Border)) e.Graphics.DrawRectangle(p, 0, 0, frame.Width - 1, frame.Height - 1); };
        var box = new ReadOnlyText {
            Multiline = true, ReadOnly = true, TabStop = false, ScrollBars = ScrollBars.None, BorderStyle = BorderStyle.None,
            BackColor = Theme.Surface, ForeColor = Theme.Text, Font = Theme.F(9.5f),
            Location = new Point(14, 14), Size = new Size(500, 208),
            Text = "Lumicord is a free, open source Discord client mod, licensed under the GNU GPL v3.0.\r\n\r\n" +
                   "• Client mods are against Discord's Terms of Service. Your account could be limited or banned. Use at your own risk.\r\n\r\n" +
                   "• Plugins run with the same access as Discord itself. Only install plugins you trust.\r\n\r\n" +
                   "• Discord updates remove Lumicord. Run this installer again and choose Repair.\r\n\r\n" +
                   "Credits\r\n" +
                   "• Vencord by Vendicated (github.com/Vendicated): github.com/Vendicated/Vencord, GPL-3.0. Lumicord ships Vencord and its plugins.\r\n" +
                   "• BetterDiscord by Jiiks (github.com/Jiiks), Zerebos (github.com/zerebos) and contributors: github.com/BetterDiscord/BetterDiscord, Apache-2.0. Lumicord runs BetterDiscord plugins and themes through its own BdApi.\r\n" +
                   "• Lumicord is not affiliated with Vencord, BetterDiscord or Discord.\r\n\r\n" +
                   "• Lumicord files are stored in " + DataDir + "\r\n\r\n" +
                   "This software is provided as is, without warranty of any kind."
        };
        frame.Controls.Add(box);
        frame.Controls.Add(new SlimScroll(box) { Location = new Point(516, 14), Size = new Size(6, 208) });
        var agree = new Check("I accept the license agreement") { Location = new Point(32, 342) };
        next.Enabled = false; agree.Changed += (o, e) => next.Enabled = agree.Checked;
        body.Controls.Add(frame); body.Controls.Add(agree);
    }

    void Actions() {
        Heading("windowcheck", "Choose an action"); Subheading("Select what you would like Lumicord to do.");
        var opts = new[] {
            new { id = "install", row = new Row("download", "Install Lumicord", "Add Lumicord to your Discord", false) },
            new { id = "repair", row = new Row("repair", "Repair Lumicord", "Reinstall after a Discord update or if something broke", false) },
            new { id = "uninstall", row = new Row("trash", "Uninstall Lumicord", "Remove Lumicord from Discord. Your plugins and themes are kept", false) },
        };
        for (int i = 0; i < opts.Length; i++) {
            var o = opts[i]; o.row.Size = new Size(536, 70); o.row.Location = new Point(32, 94 + i * 82); o.row.Selected = action == o.id;
            o.row.Click += (x, e) => { action = o.id; foreach (var c in opts) c.row.Selected = c.id == action; next.Enabled = true; };
            body.Controls.Add(o.row);
        }
        next.Enabled = action != null;
    }

    void Channels() {
        Heading("windowcheck", "Discord version"); Subheading("Pick the Discord installation to update.");
        var rows = new List<Row>();
        for (int i = 0; i < Builds.GetLength(0); i++) {
            string folder = Builds[i, 0];
            string res = ResourcesFor(folder);
            var r = new Row("app", Builds[i, 1] + (res != null ? "  ·  Found" : "  ·  Not found"), res ?? "Choose a folder to browse", true) { Size = new Size(536, 70), Location = new Point(32, 94 + i * 76), Found = res != null, Tag = folder, AppIcon = AppIconFor(folder, res) };
            r.Browse.Location = new Point(432, 18);
            r.Selected = channel == folder && res != null;
            r.Click += (x, e) => { if (!r.Found) return; channel = (string)r.Tag; foreach (var k in rows) k.Selected = k == r; next.Enabled = true; };
            r.Browse.Click += (x, e) => {
                using (var dlg = new FolderBrowserDialog { Description = "Select the " + Builds[rows.IndexOf(r), 1] + " folder (the one that contains app-* folders)" }) {
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    var picked = FindResourcesIn(dlg.SelectedPath);
                    if (picked == null) { ShowNotice("Not a Discord folder", "Choose a Discord folder containing an app-* folder with a resources directory."); return; }
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
        var separate = new Check("Don't share plugins and themes with other Discord versions") { Location = new Point(32, 326), Size = new Size(500, 26) };
        separate.Changed += (o, e) => separateProfile = separate.Checked;
        if (separateProfile) separate.Toggle();
        body.Controls.Add(separate);
        next.Text = action == "uninstall" ? "Uninstall" : action == "repair" ? "Repair" : "Install";
        next.Enabled = channel != null;
    }

    void RunInstall() {
        var ring = new StatusRing { Location = new Point(259, 76), Working = true };
        var head = new Label { Text = action == "uninstall" ? "Uninstalling" : action == "repair" ? "Repairing" : "Installing", Font = Theme.F(18, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(0, 168), Size = new Size(600, 38), TextAlign = ContentAlignment.MiddleCenter };
        var sub = new Label { Text = "This may take a moment.", Font = Theme.F(10), ForeColor = Theme.Muted, Location = new Point(0, 212), Size = new Size(600, 22), TextAlign = ContentAlignment.MiddleCenter };
        var details = new FlatButton("Show details", BtnStyle.Outline) { Location = new Point(235, 260), Size = new Size(130, 32), BackColor = Theme.Bg };
        var log = new ReadOnlyText { BackColor = Theme.Surface, ForeColor = Theme.Muted, Font = new Font("Consolas", 8.5f), Location = new Point(42, 306), Size = new Size(506, 72), Visible = false };
        var scroll = new SlimScroll(log) { Location = new Point(552, 306), Size = new Size(6, 72), Visible = false };
        details.Click += (o,e) => { bool open = !log.Visible; log.Visible = scroll.Visible = open; details.Text = open ? "Hide details" : "Show details"; details.Invalidate(); };
        body.Controls.Add(ring); body.Controls.Add(head); body.Controls.Add(sub); body.Controls.Add(details); body.Controls.Add(log); body.Controls.Add(scroll);
        next.Enabled = false; next.Text = "Close";
        int lines = 0;
        Action<string> say = m => BeginInvoke((Action)(() => { log.AppendText(m + "\r\n"); lines++; }));
        string a = action, ch = channel, custom; bool sep = separateProfile;
        customDirs.TryGetValue(ch, out custom);
        installing = true;
        Task.Run(() => {
            bool ok = true;
            try { Work(a, ch, custom, sep, say); say(""); say(a == "uninstall" ? "Lumicord was removed." : "Done. Open Discord and find Lumicord in User Settings."); }
            catch (Exception ex) { ok = false; say(""); say("Failed: " + ex.Message); }
            BeginInvoke((Action)(() => {
                installing = false;
                ring.Working = false; ring.Success = ok; ring.Invalidate();
                head.Text = ok ? (a == "uninstall" ? "Uninstalled" : "Installed") : "Something went wrong";
                installDone = ok; sidebar.Invalidate();
                sub.Text = ok ? "Lumicord is ready for Discord." : "Review the details and try again.";
                next.Enabled = true;
            }));
        });
    }

    // Developer-only visual regression capture. It never calls Work or opens a folder dialog.
    public void SaveShots(string folder) {
        Directory.CreateDirectory(folder);
        Location = new Point(-2000, -2000); Opacity = 1; Show(); Application.DoEvents();
        SaveShot(folder, "00-welcome.png");
        Show(1); Settle(); SaveShot(folder, "01-license.png");
        foreach (Check c in body.Controls.OfType<Check>()) c.Toggle(); Settle(); SaveShot(folder, "01b-license-checked.png");
        action = "install"; Show(2); Settle(); SaveShot(folder, "02-action.png");
        Show(3); Settle(); SaveShot(folder, "03-versions.png");
        ToggleCredits(); Settle(); SaveShot(folder, "04-credits.png"); ToggleCredits();
        ShowNotice("Not a Discord folder", "Choose a Discord folder containing an app-* folder with a resources directory."); Settle(); SaveShot(folder, "05-notice.png");
        foreach (Control c in viewport.Controls.OfType<Notice>().ToArray()) { viewport.Controls.Remove(c); c.Dispose(); }
        FakeFinal(true, false); Settle(); SaveShot(folder, "06-installing.png");
        FakeFinal(true, true); Settle(); SaveShot(folder, "07-success.png");
        FakeFinal(false, true); Settle(); SaveShot(folder, "08-failure.png");
        FakeFinal(false, true); foreach (Control c in body.Controls) if (c is ReadOnlyText || c is SlimScroll) c.Visible = true; Settle(); SaveShot(folder, "08b-failure-details-open.png");
    }
    void Settle() { for (int i = 0; i < 24; i++) { Application.DoEvents(); System.Threading.Thread.Sleep(16); } }
    void SaveShot(string folder, string name) {
        // DrawToBitmap can otherwise retain a stale rail buffer after synthetic final states.
        sidebar.Invalidate(); titleBar.Invalidate(); Application.DoEvents();
        using (var b = new Bitmap(W, H)) {
            DrawToBitmap(b, new Rectangle(0, 0, W, H));
            Control overlay = credits != null ? (Control)credits : viewport.Controls.OfType<Notice>().FirstOrDefault();
            if (overlay != null) using (var layer = new Bitmap(overlay.Width, overlay.Height)) {
                overlay.DrawToBitmap(layer, new Rectangle(0, 0, layer.Width, layer.Height));
                using (var g = Graphics.FromImage(b)) g.DrawImageUnscaled(layer, overlay.Left + viewport.Left, overlay.Top + viewport.Top);
            }
            b.Save(Path.Combine(folder, name), System.Drawing.Imaging.ImageFormat.Png);
        }
    }
    void FakeFinal(bool ok, bool complete) {
        step = 4; installDone = ok && complete;
        if (body != null) { viewport.Controls.Remove(body); body.Dispose(); }
        body = new Canvas { Size = viewport.Size, BackColor = Theme.Bg }; viewport.Controls.Add(body);
        var ring = new StatusRing { Location = new Point(259, 76), Working = !complete, Success = ok };
        var h = new Label { Text = complete ? (ok ? "Installed" : "Something went wrong") : "Installing", Font = Theme.F(18, FontStyle.Bold), ForeColor = Theme.Text, Location = new Point(0,168), Size = new Size(600,38), TextAlign = ContentAlignment.MiddleCenter };
        var sub = new Label { Text = complete ? (ok ? "Lumicord is ready for Discord." : "Review the details and try again.") : "This may take a moment.", Font = Theme.F(10), ForeColor = Theme.Muted, Location = new Point(0,212), Size = new Size(600,22), TextAlign = ContentAlignment.MiddleCenter };
        var details = new FlatButton("Show details", BtnStyle.Outline) { Location = new Point(235,260), Size = new Size(130,32), BackColor = Theme.Bg };
        var log = new ReadOnlyText { BackColor = Theme.Surface, ForeColor = Theme.Muted, Font = new Font("Consolas", 8.5f), Location = new Point(42,306), Size = new Size(506,72), Visible = false, Text = ok ? "Copied Lumicord files\r\nWrote loader\r\n\r\nDone." : "Copied Lumicord files\r\n\r\nFailed: Discord resources could not be updated." };
        body.Controls.Add(ring); body.Controls.Add(h); body.Controls.Add(sub); body.Controls.Add(details); body.Controls.Add(log); body.Controls.Add(new SlimScroll(log) { Location = new Point(552,306), Size = new Size(6,72), Visible = false });
        back.Visible = false; next.Text = "Close"; next.Enabled = true;
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
            .Where(d => { Version v; return Directory.Exists(Path.Combine(d, "resources")) && Version.TryParse(Path.GetFileName(d).Substring(4).Split('-')[0], out v); })
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
            // Discord updates can leave their new app.asar beside the old patched archive. Keep the newer archive
            // instead of rolling Discord back; otherwise move _app.asar into place before removing the loader.
            if (File.Exists(orig)) { if (File.Exists(asar)) File.Delete(orig); else File.Move(orig, asar); say("Restored app.asar"); }
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

        // Start menu entry, so Windows search finds "Lumicord Installer". Failing here never fails the install.
        try { if (action == "uninstall") RemoveStartMenuEntry(say); else AddStartMenuEntry(say); }
        catch (Exception e) { say("Start menu shortcut skipped: " + e.Message); }

        var update = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(res)), "Update.exe");
        if (File.Exists(update)) { say("Starting Discord…"); Process.Start(update, "--processStart " + exe); }
    }

    static string StartMenuShortcut {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Lumicord Installer.lnk"); }
    }

    // Copies this installer into %APPDATA%\Lumicord (so the shortcut still works after the download is deleted)
    // and creates a Start menu shortcut to it, using Windows' own WScript.Shell shortcut writer.
    static void AddStartMenuEntry(Action<string> say) {
        var self = Assembly.GetExecutingAssembly().Location;
        var kept = Path.Combine(DataDir, "LumicordInstaller.exe");
        if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(kept), StringComparison.OrdinalIgnoreCase)) {
            Directory.CreateDirectory(DataDir);
            File.Copy(self, kept, true);
        }
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        try {
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { StartMenuShortcut });
            var lt = link.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { kept });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { DataDir });
            lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { kept + ",0" });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Install, repair or uninstall Lumicord" });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            Marshal.ReleaseComObject(link);
        } finally { Marshal.ReleaseComObject(shell); }
        say("Added \"Lumicord Installer\" to the Start menu");
    }

    static void RemoveStartMenuEntry(Action<string> say) {
        if (File.Exists(StartMenuShortcut)) { File.Delete(StartMenuShortcut); say("Removed the Start menu shortcut"); }
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
    static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args != null && args.Length == 2 && args[0] == "--shots") {
            using (var wizard = new Wizard()) wizard.SaveShots(Path.GetFullPath(args[1]));
            return;
        }
        Application.Run(new Wizard());
    }
}
