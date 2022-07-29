"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
exports.__esModule = true;
exports.OpenElementStack = void 0;
var html_js_1 = require("../common/html.js");
//Element utils
var IMPLICIT_END_TAG_REQUIRED = new Set([html_js_1.TAG_ID.DD, html_js_1.TAG_ID.DT, html_js_1.TAG_ID.LI, html_js_1.TAG_ID.OPTGROUP, html_js_1.TAG_ID.OPTION, html_js_1.TAG_ID.P, html_js_1.TAG_ID.RB, html_js_1.TAG_ID.RP, html_js_1.TAG_ID.RT, html_js_1.TAG_ID.RTC]);
var IMPLICIT_END_TAG_REQUIRED_THOROUGHLY = new Set(__spreadArray(__spreadArray([], IMPLICIT_END_TAG_REQUIRED, true), [
    html_js_1.TAG_ID.CAPTION,
    html_js_1.TAG_ID.COLGROUP,
    html_js_1.TAG_ID.TBODY,
    html_js_1.TAG_ID.TD,
    html_js_1.TAG_ID.TFOOT,
    html_js_1.TAG_ID.TH,
    html_js_1.TAG_ID.THEAD,
    html_js_1.TAG_ID.TR,
], false));
var SCOPING_ELEMENT_NS = new Map([
    [html_js_1.TAG_ID.APPLET, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.CAPTION, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.HTML, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.MARQUEE, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.OBJECT, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.TABLE, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.TD, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.TEMPLATE, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.TH, html_js_1.NS.HTML],
    [html_js_1.TAG_ID.ANNOTATION_XML, html_js_1.NS.MATHML],
    [html_js_1.TAG_ID.MI, html_js_1.NS.MATHML],
    [html_js_1.TAG_ID.MN, html_js_1.NS.MATHML],
    [html_js_1.TAG_ID.MO, html_js_1.NS.MATHML],
    [html_js_1.TAG_ID.MS, html_js_1.NS.MATHML],
    [html_js_1.TAG_ID.MTEXT, html_js_1.NS.MATHML],
    [html_js_1.TAG_ID.DESC, html_js_1.NS.SVG],
    [html_js_1.TAG_ID.FOREIGN_OBJECT, html_js_1.NS.SVG],
    [html_js_1.TAG_ID.TITLE, html_js_1.NS.SVG],
]);
var NAMED_HEADERS = [html_js_1.TAG_ID.H1, html_js_1.TAG_ID.H2, html_js_1.TAG_ID.H3, html_js_1.TAG_ID.H4, html_js_1.TAG_ID.H5, html_js_1.TAG_ID.H6];
var TABLE_ROW_CONTEXT = [html_js_1.TAG_ID.TR, html_js_1.TAG_ID.TEMPLATE, html_js_1.TAG_ID.HTML];
var TABLE_BODY_CONTEXT = [html_js_1.TAG_ID.TBODY, html_js_1.TAG_ID.TFOOT, html_js_1.TAG_ID.THEAD, html_js_1.TAG_ID.TEMPLATE, html_js_1.TAG_ID.HTML];
var TABLE_CONTEXT = [html_js_1.TAG_ID.TABLE, html_js_1.TAG_ID.TEMPLATE, html_js_1.TAG_ID.HTML];
var TABLE_CELLS = [html_js_1.TAG_ID.TD, html_js_1.TAG_ID.TH];
//Stack of open elements
var OpenElementStack = /** @class */ (function () {
    function OpenElementStack(document, treeAdapter, handler) {
        this.treeAdapter = treeAdapter;
        this.handler = handler;
        this.items = [];
        this.tagIDs = [];
        this.stackTop = -1;
        this.tmplCount = 0;
        this.currentTagId = html_js_1.TAG_ID.UNKNOWN;
        this.current = document;
    }
    Object.defineProperty(OpenElementStack.prototype, "currentTmplContentOrNode", {
        get: function () {
            return this._isInTemplate() ? this.treeAdapter.getTemplateContent(this.current) : this.current;
        },
        enumerable: false,
        configurable: true
    });
    //Index of element
    OpenElementStack.prototype._indexOf = function (element) {
        return this.items.lastIndexOf(element, this.stackTop);
    };
    //Update current element
    OpenElementStack.prototype._isInTemplate = function () {
        return this.currentTagId === html_js_1.TAG_ID.TEMPLATE && this.treeAdapter.getNamespaceURI(this.current) === html_js_1.NS.HTML;
    };
    OpenElementStack.prototype._updateCurrentElement = function () {
        this.current = this.items[this.stackTop];
        this.currentTagId = this.tagIDs[this.stackTop];
    };
    //Mutations
    OpenElementStack.prototype.push = function (element, tagID) {
        this.stackTop++;
        this.items[this.stackTop] = element;
        this.current = element;
        this.tagIDs[this.stackTop] = tagID;
        this.currentTagId = tagID;
        if (this._isInTemplate()) {
            this.tmplCount++;
        }
        this.handler.onItemPush(element, tagID, true);
    };
    OpenElementStack.prototype.pop = function () {
        var popped = this.current;
        if (this.tmplCount > 0 && this._isInTemplate()) {
            this.tmplCount--;
        }
        this.stackTop--;
        this._updateCurrentElement();
        this.handler.onItemPop(popped, true);
    };
    OpenElementStack.prototype.replace = function (oldElement, newElement) {
        var idx = this._indexOf(oldElement);
        this.items[idx] = newElement;
        if (idx === this.stackTop) {
            this.current = newElement;
        }
    };
    OpenElementStack.prototype.insertAfter = function (referenceElement, newElement, newElementID) {
        var insertionIdx = this._indexOf(referenceElement) + 1;
        this.items.splice(insertionIdx, 0, newElement);
        this.tagIDs.splice(insertionIdx, 0, newElementID);
        this.stackTop++;
        if (insertionIdx === this.stackTop) {
            this._updateCurrentElement();
        }
        this.handler.onItemPush(this.current, this.currentTagId, insertionIdx === this.stackTop);
    };
    OpenElementStack.prototype.popUntilTagNamePopped = function (tagName) {
        var targetIdx = this.stackTop + 1;
        do {
            targetIdx = this.tagIDs.lastIndexOf(tagName, targetIdx - 1);
        } while (targetIdx > 0 && this.treeAdapter.getNamespaceURI(this.items[targetIdx]) !== html_js_1.NS.HTML);
        this.shortenToLength(targetIdx < 0 ? 0 : targetIdx);
    };
    OpenElementStack.prototype.shortenToLength = function (idx) {
        while (this.stackTop >= idx) {
            var popped = this.current;
            if (this.tmplCount > 0 && this._isInTemplate()) {
                this.tmplCount -= 1;
            }
            this.stackTop--;
            this._updateCurrentElement();
            this.handler.onItemPop(popped, this.stackTop < idx);
        }
    };
    OpenElementStack.prototype.popUntilElementPopped = function (element) {
        var idx = this._indexOf(element);
        this.shortenToLength(idx < 0 ? 0 : idx);
    };
    OpenElementStack.prototype.popUntilPopped = function (tagNames, targetNS) {
        var idx = this._indexOfTagNames(tagNames, targetNS);
        this.shortenToLength(idx < 0 ? 0 : idx);
    };
    OpenElementStack.prototype.popUntilNumberedHeaderPopped = function () {
        this.popUntilPopped(NAMED_HEADERS, html_js_1.NS.HTML);
    };
    OpenElementStack.prototype.popUntilTableCellPopped = function () {
        this.popUntilPopped(TABLE_CELLS, html_js_1.NS.HTML);
    };
    OpenElementStack.prototype.popAllUpToHtmlElement = function () {
        //NOTE: here we assume that the root <html> element is always first in the open element stack, so
        //we perform this fast stack clean up.
        this.tmplCount = 0;
        this.shortenToLength(1);
    };
    OpenElementStack.prototype._indexOfTagNames = function (tagNames, namespace) {
        for (var i = this.stackTop; i >= 0; i--) {
            if (tagNames.includes(this.tagIDs[i]) && this.treeAdapter.getNamespaceURI(this.items[i]) === namespace) {
                return i;
            }
        }
        return -1;
    };
    OpenElementStack.prototype.clearBackTo = function (tagNames, targetNS) {
        var idx = this._indexOfTagNames(tagNames, targetNS);
        this.shortenToLength(idx + 1);
    };
    OpenElementStack.prototype.clearBackToTableContext = function () {
        this.clearBackTo(TABLE_CONTEXT, html_js_1.NS.HTML);
    };
    OpenElementStack.prototype.clearBackToTableBodyContext = function () {
        this.clearBackTo(TABLE_BODY_CONTEXT, html_js_1.NS.HTML);
    };
    OpenElementStack.prototype.clearBackToTableRowContext = function () {
        this.clearBackTo(TABLE_ROW_CONTEXT, html_js_1.NS.HTML);
    };
    OpenElementStack.prototype.remove = function (element) {
        var idx = this._indexOf(element);
        if (idx >= 0) {
            if (idx === this.stackTop) {
                this.pop();
            }
            else {
                this.items.splice(idx, 1);
                this.tagIDs.splice(idx, 1);
                this.stackTop--;
                this._updateCurrentElement();
                this.handler.onItemPop(element, false);
            }
        }
    };
    //Search
    OpenElementStack.prototype.tryPeekProperlyNestedBodyElement = function () {
        //Properly nested <body> element (should be second element in stack).
        return this.stackTop >= 1 && this.tagIDs[1] === html_js_1.TAG_ID.BODY ? this.items[1] : null;
    };
    OpenElementStack.prototype.contains = function (element) {
        return this._indexOf(element) > -1;
    };
    OpenElementStack.prototype.getCommonAncestor = function (element) {
        var elementIdx = this._indexOf(element) - 1;
        return elementIdx >= 0 ? this.items[elementIdx] : null;
    };
    OpenElementStack.prototype.isRootHtmlElementCurrent = function () {
        return this.stackTop === 0 && this.tagIDs[0] === html_js_1.TAG_ID.HTML;
    };
    //Element in scope
    OpenElementStack.prototype.hasInScope = function (tagName) {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if (tn === tagName && ns === html_js_1.NS.HTML) {
                return true;
            }
            if (SCOPING_ELEMENT_NS.get(tn) === ns) {
                return false;
            }
        }
        return true;
    };
    OpenElementStack.prototype.hasNumberedHeaderInScope = function () {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if ((0, html_js_1.isNumberedHeader)(tn) && ns === html_js_1.NS.HTML) {
                return true;
            }
            if (SCOPING_ELEMENT_NS.get(tn) === ns) {
                return false;
            }
        }
        return true;
    };
    OpenElementStack.prototype.hasInListItemScope = function (tagName) {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if (tn === tagName && ns === html_js_1.NS.HTML) {
                return true;
            }
            if (((tn === html_js_1.TAG_ID.UL || tn === html_js_1.TAG_ID.OL) && ns === html_js_1.NS.HTML) || SCOPING_ELEMENT_NS.get(tn) === ns) {
                return false;
            }
        }
        return true;
    };
    OpenElementStack.prototype.hasInButtonScope = function (tagName) {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if (tn === tagName && ns === html_js_1.NS.HTML) {
                return true;
            }
            if ((tn === html_js_1.TAG_ID.BUTTON && ns === html_js_1.NS.HTML) || SCOPING_ELEMENT_NS.get(tn) === ns) {
                return false;
            }
        }
        return true;
    };
    OpenElementStack.prototype.hasInTableScope = function (tagName) {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if (ns !== html_js_1.NS.HTML) {
                continue;
            }
            if (tn === tagName) {
                return true;
            }
            if (tn === html_js_1.TAG_ID.TABLE || tn === html_js_1.TAG_ID.TEMPLATE || tn === html_js_1.TAG_ID.HTML) {
                return false;
            }
        }
        return true;
    };
    OpenElementStack.prototype.hasTableBodyContextInTableScope = function () {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if (ns !== html_js_1.NS.HTML) {
                continue;
            }
            if (tn === html_js_1.TAG_ID.TBODY || tn === html_js_1.TAG_ID.THEAD || tn === html_js_1.TAG_ID.TFOOT) {
                return true;
            }
            if (tn === html_js_1.TAG_ID.TABLE || tn === html_js_1.TAG_ID.HTML) {
                return false;
            }
        }
        return true;
    };
    OpenElementStack.prototype.hasInSelectScope = function (tagName) {
        for (var i = this.stackTop; i >= 0; i--) {
            var tn = this.tagIDs[i];
            var ns = this.treeAdapter.getNamespaceURI(this.items[i]);
            if (ns !== html_js_1.NS.HTML) {
                continue;
            }
            if (tn === tagName) {
                return true;
            }
            if (tn !== html_js_1.TAG_ID.OPTION && tn !== html_js_1.TAG_ID.OPTGROUP) {
                return false;
            }
        }
        return true;
    };
    //Implied end tags
    OpenElementStack.prototype.generateImpliedEndTags = function () {
        while (IMPLICIT_END_TAG_REQUIRED.has(this.currentTagId)) {
            this.pop();
        }
    };
    OpenElementStack.prototype.generateImpliedEndTagsThoroughly = function () {
        while (IMPLICIT_END_TAG_REQUIRED_THOROUGHLY.has(this.currentTagId)) {
            this.pop();
        }
    };
    OpenElementStack.prototype.generateImpliedEndTagsWithExclusion = function (exclusionId) {
        while (this.currentTagId !== exclusionId && IMPLICIT_END_TAG_REQUIRED_THOROUGHLY.has(this.currentTagId)) {
            this.pop();
        }
    };
    return OpenElementStack;
}());
exports.OpenElementStack = OpenElementStack;
