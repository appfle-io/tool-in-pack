// TIP 파일 일괄 이름 변경 (PowerRename 형) — v1.14.0
//
// 웹(PWA)은 JSZip 으로 이름만 바꿔 ZIP 으로 내려 주고, Mac 앱은 디스크의 이름을 실제로 바꾼다.
// 이 파일은 Mac 쪽만 맡는다 — Finder 에서 끌어다 놓은 파일(허용 목록)만, 같은 폴더 안에서,
// 겹치지 않는 이름으로만 바꾼다. 하나라도 미리 검사에서 걸리면 아무것도 바꾸지 않는다.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePair {
    pub from: String,
    pub to: String,
}

/// 창에 끌어다 놓은 경로 — rename_files 는 여기 있는 파일만 건드린다.
static DROP_ALLOWED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
const DROP_ALLOWED_MAX: usize = 512;

pub fn allow_paths(paths: &[PathBuf]) {
    let Ok(mut slot) = DROP_ALLOWED.lock() else { return };
    let set = slot.get_or_insert_with(HashSet::new);
    if set.len() + paths.len() > DROP_ALLOWED_MAX {
        set.clear();
    }
    for path in paths {
        set.insert(path.clone());
    }
}

fn is_allowed(path: &Path) -> bool {
    DROP_ALLOWED
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|set| set.contains(path)))
        .unwrap_or(false)
}

/// 새 파일 이름 하나를 검사한다 — 경로 구분자·상위 이동·빈 이름 금지.
fn check_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("새 이름이 비어 있습니다".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == ".." || trimmed.contains("..") {
        return Err(format!("쓸 수 없는 이름입니다: {trimmed}"));
    }
    if trimmed.starts_with('.') && trimmed.len() > 1 && trimmed != ".." {
        // 숨김 파일 이름은 막지 않되, '.' 하나짜리는 이미 위에서 걸렀다.
    }
    Ok(trimmed)
}

fn plan_targets(plan: &[RenamePair]) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    if plan.is_empty() {
        return Err("바꿀 파일이 없습니다".into());
    }
    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(plan.len());
    let mut sources: HashSet<PathBuf> = HashSet::new();

    for pair in plan {
        let from = PathBuf::from(pair.from.trim());
        if !from.is_absolute() || !from.exists() {
            return Err(format!("파일을 찾지 못했습니다: {}", pair.from));
        }
        if !is_allowed(&from) {
            return Err(format!("TIP 창에 끌어다 놓은 파일만 바꿀 수 있습니다: {}", pair.from));
        }
        if !sources.insert(from.clone()) {
            return Err("같은 파일이 두 번 들어 있습니다".into());
        }
        let parent = from
            .parent()
            .ok_or_else(|| "폴더 경로를 읽지 못했습니다".to_string())?
            .to_path_buf();
        let name = check_name(&pair.to)?;
        let to = parent.join(name);
        if to == from {
            continue;
        }
        // 다른 계획이 이미 같은 이름을 쓰는지.
        if targets.iter().any(|(_, existing)| existing == &to) {
            return Err(format!("새 이름이 겹칩니다: {name}"));
        }
        // 디스크에 이미 있는 이름인지 — 원래 자기 이름은 (이번에 함께 바뀌므로) 예외로 둔다.
        if to.exists() && !sources.contains(&to) && !plan.iter().any(|other| other.from.trim() == to.to_string_lossy()) {
            return Err(format!("같은 이름의 파일이 이미 있습니다: {name}"));
        }
        targets.push((from, to));
    }

    if targets.is_empty() {
        return Err("바뀌는 이름이 없습니다".into());
    }
    Ok(targets)
}

#[tauri::command]
pub fn rename_files(plan: Vec<RenamePair>) -> Result<usize, String> {
    let targets = plan_targets(&plan)?;
    let mut done = 0usize;
    for (from, to) in &targets {
        if let Err(error) = fs::rename(from, to) {
            return Err(format!(
                "{} → {} 로 바꾸지 못했습니다: {error} (이미 {}개를 바꿨습니다)",
                from.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default(),
                to.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default(),
                done
            ));
        }
        done += 1;
    }
    Ok(done)
}
