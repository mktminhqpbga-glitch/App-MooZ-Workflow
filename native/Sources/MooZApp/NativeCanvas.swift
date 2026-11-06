#if os(macOS)
import AppKit
import SwiftUI
import MooZCore

struct NativeCanvas:NSViewRepresentable {
    var graph:WorkflowGraph
    var files:[String:URL]
    var editable:Bool
    var update:(WorkflowGraph)->Void
    var error:(String)->Void
    func makeNSView(context:Context)->NSScrollView {
        let scroll=NSScrollView();scroll.hasHorizontalScroller=true;scroll.hasVerticalScroller=true
        scroll.allowsMagnification=true;scroll.minMagnification=0.25;scroll.maxMagnification=2.5
        scroll.documentView=Board(frame:NSRect(x:0,y:0,width:4_000,height:2_600))
        return scroll
    }
    func updateNSView(_ scroll:NSScrollView,context:Context){guard let board=scroll.documentView as? Board else{return};board.graph=graph;board.files=files;board.editable=editable;board.update=update;board.reportError=error;board.needsDisplay=true}
    final class Board:NSView {
        var graph=WorkflowGraph(),files:[String:URL]=[:],editable=false
        var update:((WorkflowGraph)->Void)?,reportError:((String)->Void)?
        private var selected:String?,dragOffset=NSPoint.zero,connecting:String?,pointer=NSPoint.zero
        private var images:[URL:NSImage]=[:]
        override var isFlipped:Bool{true}
        override var acceptsFirstResponder:Bool{true}
        private func rect(_ node:WorkflowNode)->NSRect{NSRect(x:node.x,y:node.y,width:220,height:155)}
        override func draw(_ dirtyRect:NSRect){
            NSColor(calibratedWhite:0.08,alpha:1).setFill();bounds.fill()
            NSColor(calibratedWhite:0.18,alpha:1).setFill()
            for x in stride(from:0,to:Int(bounds.width),by:24){for y in stride(from:0,to:Int(bounds.height),by:24){NSBezierPath(ovalIn:NSRect(x:x,y:y,width:2,height:2)).fill()}}
            for edge in graph.edges {
                guard let from=graph.nodes.first(where:{$0.id==edge.source}),let to=graph.nodes.first(where:{$0.id==edge.target}) else{continue}
                drawWire(NSPoint(x:from.x+220,y:from.y+76),NSPoint(x:to.x,y:to.y+76))
            }
            if let connecting,let node=graph.nodes.first(where:{$0.id==connecting}){drawWire(NSPoint(x:node.x+220,y:node.y+76),pointer)}
            for node in graph.nodes {
                let box=rect(node),path=NSBezierPath(roundedRect:box,xRadius:14,yRadius:14)
                NSColor(calibratedWhite:0.14,alpha:1).setFill();path.fill()
                (selected==node.id ? NSColor.controlAccentColor:NSColor(calibratedWhite:0.3,alpha:1)).setStroke();path.lineWidth=selected==node.id ? 2:1;path.stroke()
                let label=NSRect(x:box.minX+12,y:box.minY+10,width:196,height:18)
                (node.title as NSString).draw(in:label,withAttributes:[.font:NSFont.systemFont(ofSize:12,weight:.semibold),.foregroundColor:NSColor.white])
                if let id=node.assetID,let file=files[id] {
                    if images[file]==nil{images[file]=NSImage(contentsOf:file)}
                    if let image=images[file]{image.draw(in:NSRect(x:box.minX+12,y:box.minY+35,width:196,height:88),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)}
                    else{("▶ \(file.lastPathComponent)" as NSString).draw(in:NSRect(x:box.minX+12,y:box.minY+60,width:196,height:40),withAttributes:[.font:NSFont.systemFont(ofSize:12),.foregroundColor:NSColor.secondaryLabelColor])}
                }else{let title=node.kind=="assembleVideo" ? "MP4" : "\(node.kind == "generateImage" ? "Ảnh" : "Video") · AI";(title as NSString).draw(in:NSRect(x:box.minX+12,y:box.minY+67,width:196,height:30),withAttributes:[.font:NSFont.systemFont(ofSize:19,weight:.medium),.foregroundColor:NSColor.secondaryLabelColor])}
                (node.kind as NSString).draw(in:NSRect(x:box.minX+12,y:box.maxY-23,width:196,height:17),withAttributes:[.font:NSFont.systemFont(ofSize:10),.foregroundColor:NSColor.tertiaryLabelColor])
                NSColor.controlAccentColor.setFill()
                NSBezierPath(ovalIn:NSRect(x:box.minX-5,y:box.minY+71,width:10,height:10)).fill()
                NSBezierPath(ovalIn:NSRect(x:box.maxX-5,y:box.minY+71,width:10,height:10)).fill()
            }
        }
        private func drawWire(_ from:NSPoint,_ to:NSPoint){let path=NSBezierPath();path.move(to:from);path.curve(to:to,controlPoint1:NSPoint(x:from.x+100,y:from.y),controlPoint2:NSPoint(x:to.x-100,y:to.y));NSColor.controlAccentColor.withAlphaComponent(0.65).setStroke();path.lineWidth=2;path.stroke()}
        override func mouseDown(with event:NSEvent){
            window?.makeFirstResponder(self);let point=convert(event.locationInWindow,from:nil)
            selected=graph.nodes.reversed().first(where:{rect($0).insetBy(dx:-10,dy:-10).contains(point)})?.id
            if let selected,let node=graph.nodes.first(where:{$0.id==selected}){dragOffset=NSPoint(x:point.x-node.x,y:point.y-node.y);if editable,abs(point.x-(node.x+220))<14,abs(point.y-(node.y+76))<14{connecting=selected;pointer=point}}
            needsDisplay=true
        }
        override func mouseDragged(with event:NSEvent){
            let point=convert(event.locationInWindow,from:nil)
            if connecting != nil{pointer=point}else if editable,let selected,let index=graph.nodes.firstIndex(where:{$0.id==selected}){graph.nodes[index].x=max(10,point.x-dragOffset.x);graph.nodes[index].y=max(10,point.y-dragOffset.y)}
            needsDisplay=true
        }
        override func mouseUp(with event:NSEvent){
            defer{connecting=nil;needsDisplay=true}
            guard editable else{return}
            if let source=connecting {
                let point=convert(event.locationInWindow,from:nil)
                guard let target=graph.nodes.first(where:{rect($0).insetBy(dx:-10,dy:-10).contains(point)}),target.id != source else{return}
                let edge=WorkflowEdge(source,target.id)
                if !graph.edges.contains(edge){var candidate=graph;candidate.edges.append(edge);do{try candidate.validate();graph=candidate}catch{reportError?(error.localizedDescription);return}}
            }
            update?(graph)
        }
        override func keyDown(with event:NSEvent){
            if editable,event.keyCode==51,let selected{graph.edges.removeAll{$0.target==selected};update?(graph);needsDisplay=true;return}
            super.keyDown(with:event)
        }
    }
}
#endif
