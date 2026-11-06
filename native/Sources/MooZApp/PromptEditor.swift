#if os(macOS)
import AppKit
import SwiftUI

struct PromptEditor:NSViewRepresentable {
    @Binding var text:String
    var token:(String)->String
    final class Editor:NSTextView {
        var token:((String)->String)?
        override func readSelection(from pboard:NSPasteboard,type:NSPasteboard.PasteboardType)->Bool {
            if let value=pboard.string(forType:.string),value.hasPrefix("mooz-asset:"),let token {
                insertText(token(String(value.dropFirst(11))),replacementRange:selectedRange());return true
            }
            return super.readSelection(from:pboard,type:type)
        }
    }
    final class Coordinator:NSObject,NSTextViewDelegate {
        var parent:PromptEditor
        init(_ parent:PromptEditor){self.parent=parent}
        func textDidChange(_ notification:Notification){if let editor=notification.object as? NSTextView{parent.text=editor.string}}
    }
    func makeCoordinator()->Coordinator{Coordinator(self)}
    func makeNSView(context:Context)->NSScrollView {
        let scroll=NSScrollView();scroll.hasVerticalScroller=true;scroll.drawsBackground=false
        let editor=Editor(frame:.zero);editor.isRichText=false;editor.allowsUndo=true;editor.isAutomaticQuoteSubstitutionEnabled=false
        editor.font=NSFont.systemFont(ofSize:14);editor.backgroundColor = .clear;editor.textColor = .textColor;editor.drawsBackground=false
        editor.isVerticallyResizable=true;editor.isHorizontallyResizable=false;editor.autoresizingMask=[.width]
        editor.textContainer?.widthTracksTextView=true;editor.textContainerInset=NSSize(width:10,height:12)
        editor.delegate=context.coordinator;editor.token=token;editor.registerForDraggedTypes([.string]);editor.string=text
        editor.setAccessibilityLabel("Yêu cầu với thẻ ảnh tham chiếu")
        scroll.documentView=editor;return scroll
    }
    func updateNSView(_ scroll:NSScrollView,context:Context){
        context.coordinator.parent=self
        guard let editor=scroll.documentView as? Editor else{return}
        editor.token=token
        if editor.string != text{let position=editor.selectedRange();editor.string=text;editor.setSelectedRange(NSRange(location:min(position.location,(text as NSString).length),length:0))}
    }
}
#endif
