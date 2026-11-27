// TIP · 영상 내보내기 필터 그래프 — v1.25.0
//
// 화면(module.js)이 보낸 spec 을 ffmpeg 한 번의 실행으로 합치는 filter_complex 를 만든다.
// 이 파일은 tauri 에 기대지 않는 순수 코드다(AppHandle 없음). 그래서 같은 코드를 리눅스에서
// 그대로 컴파일해 실제 ffmpeg 로 MP4 를 만들어 보는 검증(tools 영상 검증)에 쓸 수 있다.
//
// v1.25.0 — 맞춤(fit)·채움(fill)·블러 배경, 회전·반전, 음소거·역재생, 색감 세부 보정
//           (eq·colorbalance·unsharp·vignette), 노이즈 제거(afftdn)·음성 변조(asetrate·tremolo·
//           aecho), 부분 모자이크·블러(crop→pixelize/boxblur→overlay, enable 구간), 도형·스티커
//           PNG 오버레이, 자막 정렬·줄간격(줄마다 drawtext)을 넣었다.
//
// 규칙
//  · 셈은 모두 초(실수). 클립 길이·경계 겹침은 model.js 와 같은 식이다.
//  · 경로·글자는 필터 안에서 깨지지 않게 임시 파일과 작은따옴표 이스케이프를 쓴다.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportTransition {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub duration: f64,
}

/// 클립의 줌/팬 — 시작·끝 배율과 중심점(0~1). 화면의 줌/팬과 같은 값을 받는다.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportMotion {
    #[serde(default)]
    pub kind: String,
    #[serde(default = "one")]
    pub start_scale: f64,
    #[serde(default = "one")]
    pub end_scale: f64,
    #[serde(default = "half")]
    pub start_x: f64,
    #[serde(default = "half")]
    pub start_y: f64,
    #[serde(default = "half")]
    pub end_x: f64,
    #[serde(default = "half")]
    pub end_y: f64,
}

/// 오버레이(PIP) — 메인 영상 위에 얹는 영상·이미지.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportOverlay {
    pub path: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "half")]
    pub y: f64,
    /// 출력 폭 대비 비율(0.05~1).
    #[serde(default = "one_third")]
    pub scale: f64,
    #[serde(default = "one")]
    pub opacity: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub path: String,
    /// "video" | "image"
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub trim_end: f64,
    #[serde(default = "one")]
    pub speed: f64,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub brightness: f64,
    #[serde(default = "one")]
    pub contrast: f64,
    #[serde(default = "one")]
    pub saturation: f64,
    /// fit | fill | blur
    #[serde(default)]
    pub fit: String,
    #[serde(default)]
    pub rotate: f64,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub reverse: bool,
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub sharpen: f64,
    #[serde(default)]
    pub vignette: f64,
    /// off | light | strong
    #[serde(default)]
    pub denoise: String,
    /// original | helium | deep | robot | echo
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub motion: Option<ExportMotion>,
    #[serde(default)]
    pub transition: Option<ExportTransition>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSubtitle {
    pub text: String,
    /// 화면(Canvas)이 나눈 줄 — 비어 있으면 text 를 줄바꿈으로 나눈다.
    #[serde(default)]
    pub lines: Vec<String>,
    /// 글자 상자 폭(1080 높이 기준 px) — 정렬할 때 쓴다.
    #[serde(default)]
    pub box_width: f64,
    /// left | center | right
    #[serde(default)]
    pub align: String,
    /// 줄간격 배율(1.28 = 기본)
    #[serde(default = "one_point_two_eight")]
    pub line_height: f64,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    /// 글꼴 키(Pretendard·helvetica…) 또는 빈 값.
    #[serde(default)]
    pub font: String,
    /// 사용자가 고른 폰트 파일(.ttf/.otf) 경로 — 있으면 이것을 쓴다.
    #[serde(default)]
    pub font_file: Option<String>,
    #[serde(default)]
    pub font_size: f64,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub outline_color: String,
    #[serde(default)]
    pub outline_width: f64,
    #[serde(default)]
    pub background: f64,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "four_fifths")]
    pub y: f64,
    /// none | fade | pop | slideup
    #[serde(default)]
    pub animation: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudio {
    pub path: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub denoise: String,
    #[serde(default)]
    pub voice: String,
}

/// 부분 모자이크·블러 — 화면 비율(0~1)로 받아 출력 픽셀로 바꾼다.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportMask {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub shape: String,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "half")]
    pub y: f64,
    #[serde(default = "one_third")]
    pub w: f64,
    #[serde(default = "one_fifth")]
    pub h: f64,
    #[serde(default = "half")]
    pub strength: f64,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
}

/// 도형·말풍선·이모지 — 화면이 그려 둔 PNG(base64)를 그대로 얹는다.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportShape {
    #[serde(default)]
    pub png: String,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "half")]
    pub y: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub clips: Vec<ExportClip>,
    #[serde(default)]
    pub overlays: Vec<ExportOverlay>,
    #[serde(default)]
    pub subtitles: Vec<ExportSubtitle>,
    #[serde(default)]
    pub audios: Vec<ExportAudio>,
    #[serde(default)]
    pub masks: Vec<ExportMask>,
    #[serde(default)]
    pub shapes: Vec<ExportShape>,
    pub width: u32,
    pub height: u32,
    #[serde(default = "thirty")]
    pub fps: u32,
    pub output: String,
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}
fn four_fifths() -> f64 {
    0.82
}
fn thirty() -> u32 {
    30
}
fn one_third() -> f64 {
    0.32
}
fn one_fifth() -> f64 {
    0.2
}
fn one_point_two_eight() -> f64 {
    1.28
}

pub struct Graph {
    pub inputs: Vec<String>,
    pub complex: String,
}

/// 글꼴·임시 파일 자리 — 앱은 app_data_dir 의 Pretendard 와 시스템 임시 폴더를 준다.
pub struct GraphEnv {
    pub bundled_font: Option<PathBuf>,
    pub temp_dir: PathBuf,
}

/* ------------------------------ 셈 ------------------------------ */

pub fn clip_visible(clip: &ExportClip) -> f64 {
    let span = (clip.trim_end - clip.trim_start).max(0.05);
    if clip.kind == "image" {
        span
    } else {
        (span / clip.speed.max(0.05)).max(0.05)
    }
}

/// 이어 붙이는 경계의 전환 길이 — 전환이 없으면 한 프레임(0.04초)짜리 아주 짧은 페이드로 붙인다.
pub fn boundary_duration(clip: &ExportClip, previous: f64) -> f64 {
    let asked = clip
        .transition
        .as_ref()
        .map(|item| item.duration)
        .unwrap_or(0.0);
    let want = if asked > 0.0 { asked } else { 0.04 };
    want.min(previous * 0.5).min(clip_visible(clip) * 0.5).max(0.02)
}

/// 타임라인 전체 길이 — 경계 겹침을 뺀 값(진행률 분모로 쓴다).
pub fn total_visible(spec: &ExportSpec) -> f64 {
    let mut sum = 0.0;
    for (index, clip) in spec.clips.iter().enumerate() {
        sum += clip_visible(clip);
        if index > 0 {
            sum -= boundary_duration(clip, clip_visible(&spec.clips[index - 1]));
        }
    }
    sum.max(0.1)
}

fn transition_name(clip: &ExportClip) -> String {
    let asked = clip
        .transition
        .as_ref()
        .map(|item| item.kind.clone())
        .unwrap_or_default();
    const KNOWN: [&str; 34] = [
        "fade", "fadeblack", "fadewhite", "dissolve", "pixelize", "radial",
        "wipeleft", "wiperight", "wipeup", "wipedown",
        "wipetl", "wipetr", "wipebl", "wipebr",
        "slideleft", "slideright", "slideup", "slidedown",
        "circleopen", "circleclose", "rectcrop",
        "vertopen", "vertclose", "horzopen", "horzclose",
        "diagtl", "diagtr", "diagbl", "diagbr",
        "hlslice", "hrslice", "vuslice", "vdslice", "squeezeh",
    ];
    if KNOWN.contains(&asked.as_str()) {
        asked
    } else if asked == "squeezev" || asked == "zoomin" || asked == "smoothleft"
        || asked == "smoothright" || asked == "smoothup" || asked == "smoothdown"
    {
        asked
    } else {
        "fade".to_string()
    }
}

pub fn atempo_chain(mut speed: f64) -> String {
    // atempo 는 0.5~100 만 받는다 — 그 밖은 두 단계로 나눈다.
    let mut parts = Vec::new();
    while speed < 0.5 {
        parts.push("atempo=0.5".to_string());
        speed /= 0.5;
    }
    while speed > 100.0 {
        parts.push("atempo=100".to_string());
        speed /= 100.0;
    }
    if (speed - 1.0).abs() > 0.001 {
        parts.push(format!("atempo={speed:.4}"));
    }
    parts.join(",")
}

/// 필터 안에 넣는 경로 — 작은따옴표로 감싸고 안의 특수 문자를 이스케이프한다.
fn filter_path(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    let escaped = text.replace('\\', "\\\\").replace('\'', "'\\''").replace(':', "\\:");
    format!("'{escaped}'")
}

fn hex_color(value: &str) -> String {
    let trimmed = value.trim().trim_start_matches('#');
    if trimmed.len() == 6 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
        format!("0x{trimmed}")
    } else {
        "0xFFFFFF".to_string()
    }
}

fn even(value: f64) -> i64 {
    let rounded = value.round() as i64;
    if rounded % 2 == 0 { rounded } else { rounded + 1 }
}

fn normalize_angle(value: f64) -> f64 {
    let angle = value % 360.0;
    if angle < 0.0 { angle + 360.0 } else { angle }
}

/* ------------------------------ 글꼴 ------------------------------ */

fn font_for(item: &ExportSubtitle, env: &GraphEnv) -> Result<PathBuf, String> {
    if let Some(path) = &item.font_file {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    let key = item.font.trim().to_lowercase();
    let system: Option<&str> = match key.as_str() {
        "helvetica" => Some("/System/Library/Fonts/Helvetica.ttc"),
        "helvetica-neue" => Some("/System/Library/Fonts/HelveticaNeue.ttc"),
        "arial" => Some("/System/Library/Fonts/Supplemental/Arial.ttf"),
        "georgia" => Some("/System/Library/Fonts/Supplemental/Georgia.ttf"),
        "impact" => Some("/System/Library/Fonts/Supplemental/Impact.ttf"),
        "apple-gothic" => Some("/System/Library/Fonts/Supplemental/AppleGothic.ttf"),
        "menlo" => Some("/System/Library/Fonts/Menlo.ttc"),
        _ => None,
    };
    if let Some(path) = system {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Some(path) = &env.bundled_font {
        if path.is_file() {
            return Ok(path.clone());
        }
    }
    if let Some(path) = system {
        // 파일이 없어도 경로는 넘겨 본다(설치된 macOS 에는 늘 있다).
        return Ok(PathBuf::from(path));
    }
    if let Some(path) = &env.bundled_font {
        return Ok(path.clone());
    }
    Err("자막에 쓸 글꼴을 찾지 못했습니다".to_string())
}

/* ------------------------------ 자막 한 줄 ------------------------------ */

/// 자막 한 줄을 drawtext 로 — 정렬(좌/중/우)·줄간격·등장 애니메이션을 화면과 같은 값으로.
fn drawtext_line(
    item: &ExportSubtitle,
    text_file: &Path,
    font_file: &Path,
    out_label: &str,
    in_label: &str,
    width: u32,
    height: u32,
    line_index: usize,
    line_count: usize,
) -> String {
    let ratio = (height as f64 / 1080.0).max(0.3);
    let size = if item.font_size > 0.0 {
        item.font_size * ratio
    } else {
        54.0 * ratio
    };
    let line_height = size * item.line_height.clamp(0.5, 3.0);
    let block_height = line_height * line_count.max(1) as f64;
    let center_y = item.y.clamp(0.0, 1.0) * height as f64;
    let top = center_y - block_height / 2.0 + line_index as f64 * line_height;
    let start = item.start.max(0.0);
    let box_width = if item.box_width > 0.0 { item.box_width * ratio } else { size * 8.0 };
    let _ = width;
    let x = match item.align.as_str() {
        "left" => format!("w*{:.4}-{:.1}", item.x.clamp(0.0, 1.0), box_width / 2.0),
        "right" => format!("w*{:.4}+{:.1}-text_w", item.x.clamp(0.0, 1.0), box_width / 2.0),
        _ => format!("(w-text_w)*{:.4}", item.x.clamp(0.0, 1.0)),
    };
    let mut y = format!("{top:.1}");
    let mut fontsize = format!("{size:.1}");
    let mut alpha: Option<String> = None;
    match item.animation.as_str() {
        "fade" => {
            alpha = Some(format!("min(1,max(0,(t-{start:.3})/0.25))"));
        }
        "pop" => {
            alpha = Some(format!("min(1,max(0,(t-{start:.3})/0.12))"));
            fontsize = format!("{size:.1}*(0.86+0.14*min(1,max(0,(t-{start:.3})/0.30)))");
        }
        "slideup" => {
            alpha = Some(format!("min(1,max(0,(t-{start:.3})/0.25))"));
            let offset = size * 0.5;
            y = format!("{top:.1}+{offset:.1}*max(0,1-(t-{start:.3})/0.30)");
        }
        _ => {}
    }
    let outline = item.outline_width.max(0.0) * ratio;
    let mut parts = vec![
        format!("fontfile={}", filter_path(font_file)),
        format!("textfile={}", filter_path(text_file)),
        format!("fontsize='{fontsize}'"),
        format!("fontcolor={}", hex_color(&item.color)),
        format!("x='{x}'"),
        format!("y='{y}'"),
        format!(
            "enable='between(t,{:.3},{:.3})'",
            item.start.max(0.0),
            item.end.max(item.start + 0.1)
        ),
    ];
    if let Some(expression) = alpha {
        parts.push(format!("alpha='{expression}'"));
    }
    if outline > 0.1 {
        parts.push(format!("borderw={outline:.1}"));
        parts.push(format!("bordercolor={}", hex_color(&item.outline_color)));
    }
    if item.background > 0.0 {
        parts.push("box=1".to_string());
        parts.push(format!("boxcolor=0x000000@{:.2}", item.background.clamp(0.0, 1.0)));
        parts.push("boxborderw=10".to_string());
    }
    format!("[{in_label}]drawtext={}[{out_label}]", parts.join(":"))
}

/* ------------------------------ 오디오 필터 ------------------------------ */

fn voice_filter(preset: &str) -> Option<&'static str> {
    match preset {
        "helium" => Some("asetrate=48000*1.28,aresample=48000,atempo=0.7813"),
        "deep" => Some("asetrate=48000*0.82,aresample=48000,atempo=1.2195"),
        "robot" => Some("tremolo=f=32:d=0.92"),
        "echo" => Some("aecho=0.8:0.9:60|120:0.38|0.24"),
        _ => None,
    }
}

fn denoise_chain(level: &str) -> Vec<&'static str> {
    match level {
        "strong" => vec!["afftdn=nr=24:nf=-25", "highpass=f=90", "lowpass=f=8000"],
        "light" => vec!["afftdn=nr=12:nf=-25"],
        _ => Vec::new(),
    }
}

/* ------------------------------ PNG(base64) ------------------------------ */

/// PNG(base64) → 바이트. 앱(video_save_png)도 같은 디코더를 쓴다.
pub fn decode_png(text: &str) -> Result<Vec<u8>, String> {
    base64_decode(text)
}

fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return Err("그림 데이터를 읽지 못했습니다".to_string()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Ok(out)
}

/* ------------------------------ 그래프 ------------------------------ */

pub fn build_graph(
    spec: &ExportSpec,
    has_audio: &[bool],
    env: &GraphEnv,
    temp_files: &mut Vec<PathBuf>,
) -> Result<Graph, String> {
    let width = (spec.width.max(16) - spec.width % 2) as i64;
    let height = (spec.height.max(16) - spec.height % 2) as i64;
    let fps = if spec.fps == 0 { 30 } else { spec.fps };

    let mut inputs: Vec<String> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    let mut input_index = 0usize;
    let mut video_labels: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    for (index, clip) in spec.clips.iter().enumerate() {
        let span = (clip.trim_end - clip.trim_start).max(0.05);
        if clip.kind == "image" {
            inputs.push("-loop".into());
            inputs.push("1".into());
            inputs.push("-t".into());
            inputs.push(format!("{span:.3}"));
        } else {
            inputs.push("-ss".into());
            inputs.push(format!("{:.3}", clip.trim_start));
            inputs.push("-t".into());
            inputs.push(format!("{span:.3}"));
        }
        inputs.push("-i".into());
        inputs.push(clip.path.clone());

        let speed = if clip.kind == "image" { 1.0 } else { clip.speed.max(0.05) };
        let visible = clip_visible(clip);
        let reverse = clip.reverse && clip.kind != "image";

        // ① 자르기·배속·프레임·역재생·회전·반전
        let mut steps: Vec<String> = vec![
            format!("trim=0:{span:.3}"),
            format!("setpts=(PTS-STARTPTS)/{speed:.4}"),
            format!("fps={fps}"),
        ];
        if reverse {
            steps.push("reverse".into());
        }
        let angle = normalize_angle(clip.rotate);
        if (angle - 90.0).abs() < 0.01 {
            steps.push("transpose=1".into());
        } else if (angle - 180.0).abs() < 0.01 {
            steps.push("transpose=1,transpose=1".into());
        } else if (angle - 270.0).abs() < 0.01 {
            steps.push("transpose=2".into());
        } else if angle.abs() > 0.01 {
            steps.push(format!(
                "rotate={angle:.4}*PI/180:ow=rotw({angle:.4}*PI/180):oh=roth({angle:.4}*PI/180):c=black"
            ));
        }
        if clip.flip_h {
            steps.push("hflip".into());
        }
        if clip.flip_v {
            steps.push("vflip".into());
        }

        // ② 맞춤 — 검정 여백 / 잘라서 채움 / 블러 배경
        let prepared = format!("c{index}p");
        match clip.fit.as_str() {
            "blur" => {
                let sigma = ((height.min(width) as f64) * 0.035).max(6.0);
                parts.push(format!(
                    "[{input_index}:v]{},split=2[c{index}bg][c{index}fg]",
                    steps.join(",")
                ));
                parts.push(format!(
                    "[c{index}bg]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},boxblur={sigma:.1}:2,eq=brightness=-0.06[c{index}bl]"
                ));
                parts.push(format!(
                    "[c{index}fg]scale={width}:{height}:force_original_aspect_ratio=decrease[c{index}sm]"
                ));
                parts.push(format!(
                    "[c{index}bl][c{index}sm]overlay=(W-w)/2:(H-h)/2:format=auto[c{index}p]"
                ));
            }
            "fill" => {
                steps.push(format!("scale={width}:{height}:force_original_aspect_ratio=increase"));
                steps.push(format!("crop={width}:{height}"));
                steps.push("setsar=1".into());
                parts.push(format!("[{input_index}:v]{}[{prepared}]", steps.join(",")));
            }
            _ => {
                steps.push(format!("scale={width}:{height}:force_original_aspect_ratio=decrease"));
                steps.push(format!("pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"));
                steps.push("setsar=1".into());
                parts.push(format!("[{input_index}:v]{}[{prepared}]", steps.join(",")));
            }
        }

        // ③ 색감 — 밝기·대비·채도(eq), 색온도(colorbalance), 선명도(unsharp), 비네트(vignette)
        let mut post: Vec<String> = vec![format!(
            "eq=brightness={:.3}:contrast={:.3}:saturation={:.3}",
            clip.brightness.clamp(-1.0, 1.0),
            clip.contrast.clamp(0.0, 3.0),
            clip.saturation.clamp(0.0, 3.0)
        )];
        let temperature = clip.temperature.clamp(-1.0, 1.0);
        if temperature.abs() > 0.01 {
            let warm = temperature * 0.3;
            post.push(format!(
                "colorbalance=rs={warm:.3}:bs={:.3}:rm={warm:.3}:bm={:.3}:rh={warm:.3}:bh={:.3}",
                -warm, -warm, -warm
            ));
        }
        let sharpen = clip.sharpen.clamp(0.0, 2.0);
        if sharpen > 0.01 {
            post.push(format!("unsharp=5:5:{:.2}:5:5:0", sharpen * 0.8));
        }
        let vignette = clip.vignette.clamp(0.0, 1.0);
        if vignette > 0.01 {
            let angle = 5.5 - 3.5 * vignette;
            post.push(format!("vignette=angle=PI/{angle:.2}"));
        }

        // ④ 줌/팬 — 2배로 키워 여유를 두고 zoompan 으로 잘라 낸다(화면과 같은 값).
        let motion = clip
            .motion
            .as_ref()
            .filter(|motion| !motion.kind.is_empty() && motion.kind != "none");
        if let Some(motion) = motion {
            let frames = (visible * fps as f64).round().max(2.0);
            let denom = (frames - 1.0).max(1.0);
            let zoom_start = motion.start_scale.clamp(1.0, 3.0);
            let zoom_end = motion.end_scale.clamp(1.0, 3.0);
            let cx_start = motion.start_x.clamp(0.0, 1.0);
            let cx_end = motion.end_x.clamp(0.0, 1.0);
            let cy_start = motion.start_y.clamp(0.0, 1.0);
            let cy_end = motion.end_y.clamp(0.0, 1.0);
            let lerp = |from: f64, to: f64| -> String {
                if (to - from).abs() < 0.0005 {
                    format!("{from:.4}")
                } else {
                    format!("{from:.4}+({to:.4}-{from:.4})*on/{denom:.1}")
                }
            };
            post.push(format!("scale={}:{}:force_original_aspect_ratio=increase", width * 2, height * 2));
            post.push(format!("crop={}:{}", width * 2, height * 2));
            post.push(format!(
                "zoompan=z='{}':x='iw*({})-(iw/zoom)/2':y='ih*({})-(ih/zoom)/2':d=1:s={width}x{height}:fps={fps}",
                lerp(zoom_start, zoom_end),
                lerp(cx_start, cx_end),
                lerp(cy_start, cy_end),
            ));
        }
        post.push("format=yuv420p".into());
        parts.push(format!("[{prepared}]{}[v{index}]", post.join(",")));
        video_labels.push(format!("v{index}"));

        // ⑤ 소리 — 역재생·음성 변조·배속·볼륨·노이즈 제거·페이드
        if has_audio.get(index).copied().unwrap_or(false) {
            let mut chain: Vec<String> = vec![
                "aresample=48000".into(),
                "aformat=sample_fmts=fltp:channel_layouts=stereo".into(),
            ];
            if reverse {
                chain.push("areverse".into());
            }
            if let Some(filter) = voice_filter(&clip.voice) {
                chain.push(filter.to_string());
            }
            let tempo = atempo_chain(speed);
            if !tempo.is_empty() {
                chain.push(tempo);
            }
            chain.push("asetpts=PTS-STARTPTS".into());
            chain.push(format!("volume={:.3}", if clip.muted { 0.0 } else { clip.volume.clamp(0.0, 4.0) }));
            for filter in denoise_chain(&clip.denoise) {
                chain.push(filter.to_string());
            }
            if clip.fade_in > 0.01 {
                chain.push(format!("afade=t=in:st=0:d={:.3}", clip.fade_in.min(visible)));
            }
            if clip.fade_out > 0.01 {
                let start = (visible - clip.fade_out).max(0.0);
                chain.push(format!("afade=t=out:st={start:.3}:d={:.3}", clip.fade_out.min(visible)));
            }
            chain.push("apad".into());
            chain.push(format!("atrim=0:{visible:.3}"));
            parts.push(format!("[{input_index}:a]{}[a{index}]", chain.join(",")));
        } else {
            parts.push(format!(
                "anullsrc=r=48000:cl=stereo,atrim=0:{visible:.3},asetpts=PTS-STARTPTS[a{index}]"
            ));
        }
        audio_labels.push(format!("a{index}"));
        input_index += 1;
    }

    if spec.clips.is_empty() {
        return Err("타임라인이 비어 있습니다".to_string());
    }

    // 이어 붙이기 — 전환은 xfade, 소리는 acrossfade 로 같은 길이만큼 겹친다.
    let mut current_v = video_labels[0].clone();
    let mut current_a = audio_labels[0].clone();
    let mut offset = 0.0;
    for index in 1..spec.clips.len() {
        let previous = clip_visible(&spec.clips[index - 1]);
        let duration = boundary_duration(&spec.clips[index], previous);
        offset += previous - duration;
        let name = if spec.clips[index].transition.as_ref().map(|item| item.duration).unwrap_or(0.0) > 0.0 {
            transition_name(&spec.clips[index])
        } else {
            "fade".to_string()
        };
        let next_v = format!("vx{index}");
        parts.push(format!(
            "[{current_v}][{current_v_in}]xfade=transition={name}:duration={duration:.3}:offset={offset:.3}[{next_v}]",
            current_v_in = video_labels[index]
        ));
        let next_a = format!("ax{index}");
        parts.push(format!(
            "[{current_a}][{current_a_in}]acrossfade=d={duration:.3}:c1=tri:c2=tri[{next_a}]",
            current_a_in = audio_labels[index]
        ));
        current_v = next_v;
        current_a = next_a;
    }

    let mut video_out = current_v;
    let mut audio_out = current_a;

    // BGM — 시작 지연·볼륨·페이드·노이즈 제거·음성 변조.
    let mut mix_labels: Vec<String> = Vec::new();
    for (index, audio) in spec.audios.iter().enumerate() {
        inputs.push("-i".into());
        inputs.push(audio.path.clone());
        let mut chain: Vec<String> = vec![
            "aresample=48000".into(),
            "aformat=sample_fmts=fltp:channel_layouts=stereo".into(),
        ];
        if let Some(filter) = voice_filter(&audio.voice) {
            chain.push(filter.to_string());
        }
        chain.push(format!(
            "volume={:.3}",
            if audio.muted { 0.0 } else { audio.volume.clamp(0.0, 4.0) }
        ));
        for filter in denoise_chain(&audio.denoise) {
            chain.push(filter.to_string());
        }
        if audio.fade_in > 0.01 {
            chain.push(format!("afade=t=in:st=0:d={:.3}", audio.fade_in));
        }
        if audio.fade_out > 0.01 && audio.duration > 0.0 {
            let start = (audio.duration - audio.fade_out).max(0.0);
            chain.push(format!("afade=t=out:st={start:.3}:d={:.3}", audio.fade_out));
        }
        if audio.start > 0.01 {
            let delay = (audio.start * 1000.0).round() as i64;
            chain.push(format!("adelay={delay}|{delay}"));
        }
        let label = format!("bgm{index}");
        parts.push(format!("[{input_index}:a]{}[{label}]", chain.join(",")));
        mix_labels.push(label);
        input_index += 1;
    }
    if !mix_labels.is_empty() {
        let mut list = format!("[{audio_out}]");
        for label in &mix_labels {
            list.push_str(&format!("[{label}]"));
        }
        parts.push(format!(
            "{list}amix=inputs={}:duration=first:dropout_transition=0:normalize=0[amixed]",
            mix_labels.len() + 1
        ));
        audio_out = "amixed".to_string();
    }

    // 오버레이(PIP) — 메인 영상 위에 크기·위치·불투명도대로 얹는다(enable 구간 동안만).
    for (index, overlay) in spec.overlays.iter().enumerate() {
        let span = (overlay.end - overlay.start).max(0.2);
        if overlay.kind == "image" {
            inputs.push("-loop".into());
            inputs.push("1".into());
            inputs.push("-t".into());
            inputs.push(format!("{span:.3}"));
        } else {
            inputs.push("-t".into());
            inputs.push(format!("{span:.3}"));
        }
        inputs.push("-i".into());
        inputs.push(overlay.path.clone());
        let box_width = ((width as f64 * overlay.scale.clamp(0.05, 1.0)).round() as i64 / 2) * 2;
        let box_width = box_width.max(16);
        let opacity = overlay.opacity.clamp(0.0, 1.0);
        parts.push(format!(
            "[{input_index}:v]trim=0:{span:.3},setpts=PTS-STARTPTS+{start:.3}/TB,scale={box_width}:-2,format=rgba,colorchannelmixer=aa={opacity:.3}[ov{index}]",
            start = overlay.start.max(0.0)
        ));
        parts.push(format!(
            "[{video_out}][ov{index}]overlay=x='W*{cx:.4}-w/2':y='H*{cy:.4}-h/2':enable='between(t,{start:.3},{end:.3})':eof_action=pass:format=auto[vo{index}]",
            cx = overlay.x.clamp(0.0, 1.0),
            cy = overlay.y.clamp(0.0, 1.0),
            start = overlay.start.max(0.0),
            end = overlay.end.max(overlay.start + 0.1)
        ));
        video_out = format!("vo{index}");
        input_index += 1;
    }

    // 부분 모자이크·블러 — 그 구간에만 잘라 낸 영역을 픽셀/블러 처리해 덮는다.
    for (index, mask) in spec.masks.iter().enumerate() {
        let start = mask.start.max(0.0);
        let end = mask.end.max(start + 0.1);
        let box_w = even((mask.w.clamp(0.01, 1.0) * width as f64).min(width as f64)).clamp(8, width);
        let box_h = even((mask.h.clamp(0.01, 1.0) * height as f64).min(height as f64)).clamp(8, height);
        let cx = mask.x.clamp(0.0, 1.0) * width as f64;
        let cy = mask.y.clamp(0.0, 1.0) * height as f64;
        let box_x = (cx - box_w as f64 / 2.0).round().clamp(0.0, (width - box_w) as f64) as i64;
        let box_y = (cy - box_h as f64 / 2.0).round().clamp(0.0, (height - box_h) as f64) as i64;
        let strength = mask.strength.clamp(0.05, 1.0);
        let mut filter = format!("crop={box_w}:{box_h}:{box_x}:{box_y}");
        if mask.kind == "blur" {
            let sigma = ((box_w.min(box_h) as f64) * 0.12 * strength).max(2.0);
            filter.push_str(&format!(",boxblur={sigma:.1}:2"));
        } else {
            let blocks = (4.0 + strength * 20.0).round().max(3.0);
            let bw = ((box_w as f64 / blocks).round() as i64).max(2);
            let bh = ((box_h as f64 / blocks).round() as i64).max(2);
            filter.push_str(&format!(
                ",scale={bw}:{bh}:flags=neighbor,scale={box_w}:{box_h}:flags=neighbor"
            ));
        }
        filter.push_str(",format=rgba");
        if mask.shape == "ellipse" {
            let rx = (box_w as f64 / 2.0).max(1.0);
            let ry = (box_h as f64 / 2.0).max(1.0);
            filter.push_str(&format!(
                ",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*lt(pow(X-{rx:.1},2)/({rx:.1}*{rx:.1})+pow(Y-{ry:.1},2)/({ry:.1}*{ry:.1}),1)'"
            ));
        }
        parts.push(format!("[{video_out}]split=2[mb{index}][ms{index}]"));
        parts.push(format!("[ms{index}]{filter}[mk{index}]"));
        parts.push(format!(
            "[mb{index}][mk{index}]overlay={box_x}:{box_y}:enable='between(t,{start:.3},{end:.3})':format=auto[mo{index}]"
        ));
        video_out = format!("mo{index}");
    }

    // 자막 — 줄마다 drawtext(정렬·줄간격이 화면과 같다). 글자는 임시 파일에 넣는다.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    for (index, item) in spec.subtitles.iter().enumerate() {
        if item.end <= item.start {
            continue;
        }
        let raw_lines: Vec<String> = if item.lines.is_empty() {
            item.text.split('\n').map(|line| line.to_string()).collect()
        } else {
            item.lines.clone()
        };
        let lines: Vec<String> = raw_lines.into_iter().filter(|line| !line.trim().is_empty()).collect();
        if lines.is_empty() {
            continue;
        }
        let font = font_for(item, env)?;
        for (line_index, line) in lines.iter().enumerate() {
            let text_file = env
                .temp_dir
                .join(format!("tip-subtitle-{stamp}-{index}-{line_index}.txt"));
            fs::write(&text_file, line).map_err(|error| format!("자막을 쓰지 못했습니다: {error}"))?;
            temp_files.push(text_file.clone());
            let next = format!("vt{index}_{line_index}");
            parts.push(drawtext_line(
                item,
                &text_file,
                &font,
                &next,
                &video_out,
                width as u32,
                height as u32,
                line_index,
                lines.len(),
            ));
            video_out = next;
        }
    }

    // 도형·말풍선·이모지 — 화면이 그린 PNG 를 그대로 얹는다(회전·크기는 PNG 안에 이미 반영).
    for (index, shape) in spec.shapes.iter().enumerate() {
        if shape.png.is_empty() {
            continue;
        }
        let span = (shape.end - shape.start).max(0.2);
        let path = env.temp_dir.join(format!("tip-shape-{stamp}-{index}.png"));
        let bytes = base64_decode(&shape.png)?;
        fs::write(&path, bytes).map_err(|error| format!("스티커를 쓰지 못했습니다: {error}"))?;
        temp_files.push(path.clone());
        inputs.push("-framerate".into());
        inputs.push(format!("{fps}"));
        inputs.push("-loop".into());
        inputs.push("1".into());
        inputs.push("-t".into());
        inputs.push(format!("{span:.3}"));
        inputs.push("-i".into());
        inputs.push(path.to_string_lossy().to_string());
        parts.push(format!(
            "[{input_index}:v]format=rgba,colorchannelmixer=aa={:.3},setpts=PTS-STARTPTS+{start:.3}/TB[sh{index}]",
            shape.opacity.clamp(0.0, 1.0),
            start = shape.start.max(0.0)
        ));
        parts.push(format!(
            "[{video_out}][sh{index}]overlay=x='W*{cx:.4}-w/2':y='H*{cy:.4}-h/2':enable='between(t,{start:.3},{end:.3})':eof_action=pass:format=auto[so{index}]",
            cx = shape.x.clamp(0.0, 1.0),
            cy = shape.y.clamp(0.0, 1.0),
            start = shape.start.max(0.0),
            end = shape.end.max(shape.start + 0.1)
        ));
        video_out = format!("so{index}");
        input_index += 1;
    }

    // 마지막에 SAR 를 1:1 로 고정한다(회전·스케일 필터가 SAR 을 흔들어 화면이 늘어나는 것을 막는다).
    parts.push(format!("[{video_out}]setsar=1,null[vout]"));
    if audio_out != "aout" {
        parts.push(format!("[{audio_out}]anull[aout]"));
    }

    Ok(Graph {
        inputs,
        complex: parts.join(";"),
    })
}
