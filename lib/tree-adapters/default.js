"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
exports.__esModule = true;
exports.defaultTreeAdapter = exports.NodeType = void 0;
var html_js_1 = require("../common/html.js");
var NodeType;
(function (NodeType) {
    NodeType["Document"] = "#document";
    NodeType["DocumentFragment"] = "#document-fragment";
    NodeType["Comment"] = "#comment";
    NodeType["Text"] = "#text";
    NodeType["DocumentType"] = "#documentType";
})(NodeType = exports.NodeType || (exports.NodeType = {}));
function createTextNode(value) {
    return {
        nodeName: NodeType.Text,
        value: value,
        parentNode: null
    };
}
exports.defaultTreeAdapter = {
    //Node construction
    createDocument: function () {
        return {
            nodeName: NodeType.Document,
            mode: html_js_1.DOCUMENT_MODE.NO_QUIRKS,
            childNodes: []
        };
    },
    createDocumentFragment: function () {
        return {
            nodeName: NodeType.DocumentFragment,
            childNodes: []
        };
    },
    createElement: function (tagName, namespaceURI, attrs) {
        return {
            nodeName: tagName,
            tagName: tagName,
            attrs: attrs,
            namespaceURI: namespaceURI,
            childNodes: [],
            parentNode: null
        };
    },
    createCommentNode: function (data) {
        return {
            nodeName: NodeType.Comment,
            data: data,
            parentNode: null
        };
    },
    //Tree mutation
    appendChild: function (parentNode, newNode) {
        parentNode.childNodes.push(newNode);
        newNode.parentNode = parentNode;
    },
    insertBefore: function (parentNode, newNode, referenceNode) {
        var insertionIdx = parentNode.childNodes.indexOf(referenceNode);
        parentNode.childNodes.splice(insertionIdx, 0, newNode);
        newNode.parentNode = parentNode;
    },
    setTemplateContent: function (templateElement, contentElement) {
        templateElement.content = contentElement;
    },
    getTemplateContent: function (templateElement) {
        return templateElement.content;
    },
    setDocumentType: function (document, name, publicId, systemId) {
        var doctypeNode = document.childNodes.find(function (node) { return node.nodeName === NodeType.DocumentType; });
        if (doctypeNode) {
            doctypeNode.name = name;
            doctypeNode.publicId = publicId;
            doctypeNode.systemId = systemId;
        }
        else {
            var node = {
                nodeName: NodeType.DocumentType,
                name: name,
                publicId: publicId,
                systemId: systemId,
                parentNode: null
            };
            exports.defaultTreeAdapter.appendChild(document, node);
        }
    },
    setDocumentMode: function (document, mode) {
        document.mode = mode;
    },
    getDocumentMode: function (document) {
        return document.mode;
    },
    detachNode: function (node) {
        if (node.parentNode) {
            var idx = node.parentNode.childNodes.indexOf(node);
            node.parentNode.childNodes.splice(idx, 1);
            node.parentNode = null;
        }
    },
    insertText: function (parentNode, text) {
        if (parentNode.childNodes.length > 0) {
            var prevNode = parentNode.childNodes[parentNode.childNodes.length - 1];
            if (exports.defaultTreeAdapter.isTextNode(prevNode)) {
                prevNode.value += text;
                return;
            }
        }
        exports.defaultTreeAdapter.appendChild(parentNode, createTextNode(text));
    },
    insertTextBefore: function (parentNode, text, referenceNode) {
        var prevNode = parentNode.childNodes[parentNode.childNodes.indexOf(referenceNode) - 1];
        if (prevNode && exports.defaultTreeAdapter.isTextNode(prevNode)) {
            prevNode.value += text;
        }
        else {
            exports.defaultTreeAdapter.insertBefore(parentNode, createTextNode(text), referenceNode);
        }
    },
    adoptAttributes: function (recipient, attrs) {
        var recipientAttrsMap = new Set(recipient.attrs.map(function (attr) { return attr.name; }));
        for (var j = 0; j < attrs.length; j++) {
            if (!recipientAttrsMap.has(attrs[j].name)) {
                recipient.attrs.push(attrs[j]);
            }
        }
    },
    //Tree traversing
    getFirstChild: function (node) {
        return node.childNodes[0];
    },
    getChildNodes: function (node) {
        return node.childNodes;
    },
    getParentNode: function (node) {
        return node.parentNode;
    },
    getAttrList: function (element) {
        return element.attrs;
    },
    //Node data
    getTagName: function (element) {
        return element.tagName;
    },
    getNamespaceURI: function (element) {
        return element.namespaceURI;
    },
    getTextNodeContent: function (textNode) {
        return textNode.value;
    },
    getCommentNodeContent: function (commentNode) {
        return commentNode.data;
    },
    getDocumentTypeNodeName: function (doctypeNode) {
        return doctypeNode.name;
    },
    getDocumentTypeNodePublicId: function (doctypeNode) {
        return doctypeNode.publicId;
    },
    getDocumentTypeNodeSystemId: function (doctypeNode) {
        return doctypeNode.systemId;
    },
    //Node types
    isTextNode: function (node) {
        return node.nodeName === '#text';
    },
    isCommentNode: function (node) {
        return node.nodeName === '#comment';
    },
    isDocumentTypeNode: function (node) {
        return node.nodeName === NodeType.DocumentType;
    },
    isElementNode: function (node) {
        return Object.prototype.hasOwnProperty.call(node, 'tagName');
    },
    // Source code location
    setNodeSourceCodeLocation: function (node, location) {
        node.sourceCodeLocation = location;
    },
    getNodeSourceCodeLocation: function (node) {
        return node.sourceCodeLocation;
    },
    updateNodeSourceCodeLocation: function (node, endLocation) {
        node.sourceCodeLocation = __assign(__assign({}, node.sourceCodeLocation), endLocation);
    }
};
