// TIP v1.25.0 — 영상 필터 그래프 검증 하네스
//
// 앱이 쓰는 `mac/src-tauri/src/video_graph.rs` 를 **그대로** 컴파일해, spec JSON 으로
// filter_complex 문자열을 뽑는다. `tools/video-graph-test.mjs` 가 이 결과를 ffmpeg 에 넣어
// 실제 MP4 를 만들고 프레임을 확인한다(문법·따옴표·스트림 매핑 오류 0건 확인).
#[path = "../../../mac/src-tauri/src/video_graph.rs"]
mod video_graph;

use std::path::PathBuf;
use video_graph::{build_graph, ExportSpec, GraphEnv};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let spec_path = args.get(1).expect("spec json 경로가 필요합니다");
    let font = args.get(2).cloned().unwrap_or_default();
    let text = std::fs::read_to_string(spec_path).expect("spec 을 읽지 못했습니다");
    let spec: ExportSpec = serde_json::from_str(&text).expect("spec 형식이 올바르지 않습니다");
    let has_audio: Vec<bool> = spec.clips.iter().map(|clip| clip.kind != "image").collect();
    let env = GraphEnv {
        bundled_font: if font.is_empty() { None } else { Some(PathBuf::from(font)) },
        temp_dir: std::env::temp_dir(),
    };
    let mut temp_files: Vec<PathBuf> = Vec::new();
    match build_graph(&spec, &has_audio, &env, &mut temp_files) {
        Ok(graph) => {
            let out = serde_json::json!({
                "inputs": graph.inputs,
                "complex": graph.complex,
                "temp": temp_files.iter().map(|path| path.to_string_lossy().to_string()).collect::<Vec<_>>(),
            });
            println!("{}", serde_json::to_string(&out).unwrap());
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
