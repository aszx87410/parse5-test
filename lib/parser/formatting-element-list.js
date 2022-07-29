"use strict";
exports.__esModule = true;
exports.FormattingElementList = exports.EntryType = void 0;
//Const
var NOAH_ARK_CAPACITY = 3;
var EntryType;
(function (EntryType) {
    EntryType[EntryType["Marker"] = 0] = "Marker";
    EntryType[EntryType["Element"] = 1] = "Element";
})(EntryType = exports.EntryType || (exports.EntryType = {}));
var MARKER = { type: EntryType.Marker };
//List of formatting elements
var FormattingElementList = /** @class */ (function () {
    function FormattingElementList(treeAdapter) {
        this.treeAdapter = treeAdapter;
        this.entries = [];
        this.bookmark = null;
    }
    //Noah Ark's condition
    //OPTIMIZATION: at first we try to find possible candidates for exclusion using
    //lightweight heuristics without thorough attributes check.
    FormattingElementList.prototype._getNoahArkConditionCandidates = function (newElement, neAttrs) {
        var candidates = [];
        var neAttrsLength = neAttrs.length;
        var neTagName = this.treeAdapter.getTagName(newElement);
        var neNamespaceURI = this.treeAdapter.getNamespaceURI(newElement);
        for (var i = 0; i < this.entries.length; i++) {
            var entry = this.entries[i];
            if (entry.type === EntryType.Marker) {
                break;
            }
            var element = entry.element;
            if (this.treeAdapter.getTagName(element) === neTagName &&
                this.treeAdapter.getNamespaceURI(element) === neNamespaceURI) {
                var elementAttrs = this.treeAdapter.getAttrList(element);
                if (elementAttrs.length === neAttrsLength) {
                    candidates.push({ idx: i, attrs: elementAttrs });
                }
            }
        }
        return candidates;
    };
    FormattingElementList.prototype._ensureNoahArkCondition = function (newElement) {
        if (this.entries.length < NOAH_ARK_CAPACITY)
            return;
        var neAttrs = this.treeAdapter.getAttrList(newElement);
        var candidates = this._getNoahArkConditionCandidates(newElement, neAttrs);
        if (candidates.length < NOAH_ARK_CAPACITY)
            return;
        //NOTE: build attrs map for the new element, so we can perform fast lookups
        var neAttrsMap = new Map(neAttrs.map(function (neAttr) { return [neAttr.name, neAttr.value]; }));
        var validCandidates = 0;
        //NOTE: remove bottommost candidates, until Noah's Ark condition will not be met
        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];
            // We know that `candidate.attrs.length === neAttrs.length`
            if (candidate.attrs.every(function (cAttr) { return neAttrsMap.get(cAttr.name) === cAttr.value; })) {
                validCandidates += 1;
                if (validCandidates >= NOAH_ARK_CAPACITY) {
                    this.entries.splice(candidate.idx, 1);
                }
            }
        }
    };
    //Mutations
    FormattingElementList.prototype.insertMarker = function () {
        this.entries.unshift(MARKER);
    };
    FormattingElementList.prototype.pushElement = function (element, token) {
        this._ensureNoahArkCondition(element);
        this.entries.unshift({
            type: EntryType.Element,
            element: element,
            token: token
        });
    };
    FormattingElementList.prototype.insertElementAfterBookmark = function (element, token) {
        var bookmarkIdx = this.entries.indexOf(this.bookmark);
        this.entries.splice(bookmarkIdx, 0, {
            type: EntryType.Element,
            element: element,
            token: token
        });
    };
    FormattingElementList.prototype.removeEntry = function (entry) {
        var entryIndex = this.entries.indexOf(entry);
        if (entryIndex >= 0) {
            this.entries.splice(entryIndex, 1);
        }
    };
    /**
     * Clears the list of formatting elements up to the last marker.
     *
     * @see https://html.spec.whatwg.org/multipage/parsing.html#clear-the-list-of-active-formatting-elements-up-to-the-last-marker
     */
    FormattingElementList.prototype.clearToLastMarker = function () {
        var markerIdx = this.entries.indexOf(MARKER);
        if (markerIdx >= 0) {
            this.entries.splice(0, markerIdx + 1);
        }
        else {
            this.entries.length = 0;
        }
    };
    //Search
    FormattingElementList.prototype.getElementEntryInScopeWithTagName = function (tagName) {
        var _this = this;
        var entry = this.entries.find(function (entry) { return entry.type === EntryType.Marker || _this.treeAdapter.getTagName(entry.element) === tagName; });
        return entry && entry.type === EntryType.Element ? entry : null;
    };
    FormattingElementList.prototype.getElementEntry = function (element) {
        return this.entries.find(function (entry) { return entry.type === EntryType.Element && entry.element === element; });
    };
    return FormattingElementList;
}());
exports.FormattingElementList = FormattingElementList;
