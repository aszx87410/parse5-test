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
exports.serializeOuter = exports.serialize = void 0;
var html_js_1 = require("../common/html.js");
var escape_js_1 = require("entities/lib/escape.js");
var default_js_1 = require("../tree-adapters/default.js");
// Sets
var VOID_ELEMENTS = new Set([
    html_js_1.TAG_NAMES.AREA,
    html_js_1.TAG_NAMES.BASE,
    html_js_1.TAG_NAMES.BASEFONT,
    html_js_1.TAG_NAMES.BGSOUND,
    html_js_1.TAG_NAMES.BR,
    html_js_1.TAG_NAMES.COL,
    html_js_1.TAG_NAMES.EMBED,
    html_js_1.TAG_NAMES.FRAME,
    html_js_1.TAG_NAMES.HR,
    html_js_1.TAG_NAMES.IMG,
    html_js_1.TAG_NAMES.INPUT,
    html_js_1.TAG_NAMES.KEYGEN,
    html_js_1.TAG_NAMES.LINK,
    html_js_1.TAG_NAMES.META,
    html_js_1.TAG_NAMES.PARAM,
    html_js_1.TAG_NAMES.SOURCE,
    html_js_1.TAG_NAMES.TRACK,
    html_js_1.TAG_NAMES.WBR,
]);
function isVoidElement(node, options) {
    return (options.treeAdapter.isElementNode(node) &&
        options.treeAdapter.getNamespaceURI(node) === html_js_1.NS.HTML &&
        VOID_ELEMENTS.has(options.treeAdapter.getTagName(node)));
}
var defaultOpts = { treeAdapter: default_js_1.defaultTreeAdapter, scriptingEnabled: true };
/**
 * Serializes an AST node to an HTML string.
 *
 * @example
 *
 * ```js
 * const parse5 = require('parse5');
 *
 * const document = parse5.parse('<!DOCTYPE html><html><head></head><body>Hi there!</body></html>');
 *
 * // Serializes a document.
 * const html = parse5.serialize(document);
 *
 * // Serializes the <html> element content.
 * const str = parse5.serialize(document.childNodes[1]);
 *
 * console.log(str); //> '<head></head><body>Hi there!</body>'
 * ```
 *
 * @param node Node to serialize.
 * @param options Serialization options.
 */
function serialize(node, options) {
    var opts = __assign(__assign({}, defaultOpts), options);
    if (isVoidElement(node, opts)) {
        return '';
    }
    return serializeChildNodes(node, opts);
}
exports.serialize = serialize;
/**
 * Serializes an AST element node to an HTML string, including the element node.
 *
 * @example
 *
 * ```js
 * const parse5 = require('parse5');
 *
 * const document = parse5.parseFragment('<div>Hello, <b>world</b>!</div>');
 *
 * // Serializes the <div> element.
 * const html = parse5.serializeOuter(document.childNodes[0]);
 *
 * console.log(str); //> '<div>Hello, <b>world</b>!</div>'
 * ```
 *
 * @param node Node to serialize.
 * @param options Serialization options.
 */
function serializeOuter(node, options) {
    var opts = __assign(__assign({}, defaultOpts), options);
    return serializeNode(node, opts);
}
exports.serializeOuter = serializeOuter;
function serializeChildNodes(parentNode, options) {
    var html = '';
    // Get container of the child nodes
    var container = options.treeAdapter.isElementNode(parentNode) &&
        options.treeAdapter.getTagName(parentNode) === html_js_1.TAG_NAMES.TEMPLATE &&
        options.treeAdapter.getNamespaceURI(parentNode) === html_js_1.NS.HTML
        ? options.treeAdapter.getTemplateContent(parentNode)
        : parentNode;
    var childNodes = options.treeAdapter.getChildNodes(container);
    if (childNodes) {
        for (var _i = 0, childNodes_1 = childNodes; _i < childNodes_1.length; _i++) {
            var currentNode = childNodes_1[_i];
            html += serializeNode(currentNode, options);
        }
    }
    return html;
}
function serializeNode(node, options) {
    if (options.treeAdapter.isElementNode(node)) {
        return serializeElement(node, options);
    }
    if (options.treeAdapter.isTextNode(node)) {
        return serializeTextNode(node, options);
    }
    if (options.treeAdapter.isCommentNode(node)) {
        return serializeCommentNode(node, options);
    }
    if (options.treeAdapter.isDocumentTypeNode(node)) {
        return serializeDocumentTypeNode(node, options);
    }
    // Return an empty string for unknown nodes
    return '';
}
function serializeElement(node, options) {
    var tn = options.treeAdapter.getTagName(node);
    return "<".concat(tn).concat(serializeAttributes(node, options), ">").concat(isVoidElement(node, options) ? '' : "".concat(serializeChildNodes(node, options), "</").concat(tn, ">"));
}
function serializeAttributes(node, _a) {
    var treeAdapter = _a.treeAdapter;
    var html = '';
    for (var _i = 0, _b = treeAdapter.getAttrList(node); _i < _b.length; _i++) {
        var attr = _b[_i];
        html += ' ';
        if (!attr.namespace) {
            html += attr.name;
        }
        else
            switch (attr.namespace) {
                case html_js_1.NS.XML: {
                    html += "xml:".concat(attr.name);
                    break;
                }
                case html_js_1.NS.XMLNS: {
                    if (attr.name !== 'xmlns') {
                        html += 'xmlns:';
                    }
                    html += attr.name;
                    break;
                }
                case html_js_1.NS.XLINK: {
                    html += "xlink:".concat(attr.name);
                    break;
                }
                default: {
                    html += "".concat(attr.prefix, ":").concat(attr.name);
                }
            }
        html += "=\"".concat((0, escape_js_1.escapeAttribute)(attr.value), "\"");
    }
    return html;
}
function serializeTextNode(node, options) {
    var treeAdapter = options.treeAdapter;
    var content = treeAdapter.getTextNodeContent(node);
    var parent = treeAdapter.getParentNode(node);
    var parentTn = parent && treeAdapter.isElementNode(parent) && treeAdapter.getTagName(parent);
    return parentTn &&
        treeAdapter.getNamespaceURI(parent) === html_js_1.NS.HTML &&
        (0, html_js_1.hasUnescapedText)(parentTn, options.scriptingEnabled)
        ? content
        : (0, escape_js_1.escapeText)(content);
}
function serializeCommentNode(node, _a) {
    var treeAdapter = _a.treeAdapter;
    return "<!--".concat(treeAdapter.getCommentNodeContent(node), "-->");
}
function serializeDocumentTypeNode(node, _a) {
    var treeAdapter = _a.treeAdapter;
    return "<!DOCTYPE ".concat(treeAdapter.getDocumentTypeNodeName(node), ">");
}
