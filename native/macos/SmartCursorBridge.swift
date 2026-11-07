import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Vision

func emit(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object) else {
        let fallback = #"{"ok":false,"error":"invalid-json"}"#
        FileHandle.standardOutput.write(fallback.data(using: .utf8)!)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func boolValue(_ value: Bool) -> NSNumber {
    NSNumber(value: value)
}

func isTrusted() -> Bool {
    AXIsProcessTrusted()
}

func promptTrust() {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [key: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
}

func copyAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    if error == .success {
        return value
    }
    return nil
}

func frontmostInfo() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        return ["ok": boolValue(false), "error": "no-frontmost"]
    }
    var title = ""
    if isTrusted() {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        if let window = copyAttribute(axApp, kAXFocusedWindowAttribute as String) {
            let windowElement = window as! AXUIElement
            if let value = copyAttribute(windowElement, kAXTitleAttribute as String) as? String {
                title = value
            }
        }
    }
    return [
        "ok": boolValue(true),
        "name": app.localizedName ?? "",
        "bundleId": app.bundleIdentifier ?? "",
        "pid": NSNumber(value: app.processIdentifier),
        "title": title,
        "accessibility": boolValue(isTrusted())
    ]
}

func postCommand(_ keyCode: CGKeyCode) {
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

func restoreClipboard(_ pasteboard: NSPasteboard, _ previous: String?) {
    pasteboard.clearContents()
    if let previous {
        pasteboard.setString(previous, forType: .string)
    }
}

func selectedText(allowClipboard: Bool) -> [String: Any] {
    guard isTrusted() else {
        return ["ok": boolValue(false), "error": "accessibility-denied", "text": "", "method": "none"]
    }
    guard let app = NSWorkspace.shared.frontmostApplication else {
        return ["ok": boolValue(false), "error": "no-frontmost", "text": "", "method": "none"]
    }

    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    if let focused = copyAttribute(axApp, kAXFocusedUIElementAttribute as String) {
        let focusedElement = focused as! AXUIElement
        if let text = copyAttribute(focusedElement, kAXSelectedTextAttribute as String) as? String, !text.isEmpty {
            return ["ok": boolValue(true), "text": text, "method": "ax"]
        }
    }

    if !allowClipboard {
        return ["ok": boolValue(true), "text": "", "method": "none"]
    }

    let pasteboard = NSPasteboard.general
    let previous = pasteboard.string(forType: .string)
    let sentinel = "SC_SENTINEL_\(UUID().uuidString)"
    pasteboard.clearContents()
    pasteboard.setString(sentinel, forType: .string)
    postCommand(8)
    usleep(180_000)
    var next = pasteboard.string(forType: .string)
    if next == sentinel {
        usleep(220_000)
        next = pasteboard.string(forType: .string)
    }
    restoreClipboard(pasteboard, previous)
    if let next, next != sentinel, !next.isEmpty {
        return ["ok": boolValue(true), "text": next, "method": "clipboard"]
    }
    return ["ok": boolValue(true), "text": "", "method": "none"]
}

func pasteText() -> [String: Any] {
    guard isTrusted() else {
        return ["ok": boolValue(false), "error": "accessibility-denied"]
    }
    postCommand(9)
    return ["ok": boolValue(true)]
}

func activateApp(_ bundleId: String) -> [String: Any] {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else {
        return ["ok": boolValue(false), "error": "not-running"]
    }
    guard let from = NSWorkspace.shared.frontmostApplication else {
        return ["ok": boolValue(false), "error": "no-frontmost"]
    }
    let activated = app.activate(from: from, options: [])
    return ["ok": boolValue(activated)]
}

func recognize(_ path: String) -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: url) else {
        return ["ok": boolValue(false), "error": "unreadable-image", "text": ""]
    }
    var proposed = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &proposed, context: nil, hints: nil) else {
        return ["ok": boolValue(false), "error": "cgimage", "text": ""]
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        return ["ok": boolValue(true), "text": lines.joined(separator: "\n")]
    } catch {
        return ["ok": boolValue(false), "error": "ocr-failed", "text": ""]
    }
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    emit(["ok": boolValue(false), "error": "usage"])
    exit(1)
}

switch arguments[1] {
case "status":
    emit(["ok": boolValue(true), "accessibility": boolValue(isTrusted())])
case "prompt-accessibility":
    promptTrust()
    emit(["ok": boolValue(true), "accessibility": boolValue(isTrusted())])
case "frontmost":
    emit(frontmostInfo())
case "selected-text":
    emit(selectedText(allowClipboard: arguments.count < 3 || arguments[2] != "ax-only"))
case "paste":
    emit(pasteText())
case "activate":
    emit(activateApp(arguments.count > 2 ? arguments[2] : ""))
case "ocr":
    emit(recognize(arguments.count > 2 ? arguments[2] : ""))
default:
    emit(["ok": boolValue(false), "error": "unknown-command"])
    exit(1)
}
