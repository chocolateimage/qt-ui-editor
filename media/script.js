(function () {
	const vscode = acquireVsCodeApi();

	let currentSelection = null;
	let rootWidget = null;
	let lastXMLSerialized = null;
	let widgetLoadErrors = [];

	function setCurrentSelection(newSelection) {
		if (newSelection === currentSelection) {
			return;
		}
		if (currentSelection !== null) {
			currentSelection._unselect();
		}
		currentSelection = newSelection;
		if (newSelection !== null) {
			newSelection._select();
		}
	}

	function createXMLBasicProperty(doc, name, type, value) {
		const property = doc.createElement("property");
		property.setAttribute("name", name);
		const propertyValue = doc.createElement(type);
		propertyValue.textContent = value;
		property.appendChild(propertyValue);
		return property;
	}
	function getDataFromXMLProperty(/** @type {Element} */ element) {
		const name = element.getAttribute("name");
		const valueRaw = element.children[0];
		let value = null;

		if (valueRaw.tagName === "rect") {
			value = {
				x: parseInt(valueRaw.getElementsByTagName("x")[0].textContent),
				y: parseInt(valueRaw.getElementsByTagName("y")[0].textContent),
				width: parseInt(valueRaw.getElementsByTagName("width")[0].textContent),
				height: parseInt(valueRaw.getElementsByTagName("height")[0].textContent),
			};
		} else if (valueRaw.tagName == "sizepolicy") {
			value = {
				horizontal: "QSizePolicy::" + valueRaw.getAttribute("hsizetype"),
				vertical: "QSizePolicy::" + valueRaw.getAttribute("vsizetype"),
			};
		} else if (valueRaw.tagName == "bool") {
			value = valueRaw.textContent === "true";
		} else if (valueRaw.tagName == "number") {
			value = parseInt(valueRaw.textContent);
		} else {
			value = valueRaw.textContent;
		}
		
		return { name, value };
	}

	function getWidgetByName(name, start) {
		const widget = start ?? rootWidget;
		if (widget.name == name) {
			return widget;
		}
		for (const child of widget.children) {
			const found = getWidgetByName(name, child);
			if (found != null) {
				return found;
			}
		}
		return null;
	}

	function updateSelectionPosition() {
		if (currentSelection == null) {
			return;
		}
		currentSelection._updateSelection();
	}

	const enumAlignmentHorizontal = [
		{constant: "Qt::AlignLeft", label: "Left"},
		{constant: "Qt::AlignHCenter", label: "Center"},
		{constant: "Qt::AlignRight", label: "Right"},
		{constant: "Qt::AlignJustify", label: "Justify"},
	];

	const enumAlignmentVertical = [
		{constant: "Qt::AlignTop", label: "Top"},
		{constant: "Qt::AlignVCenter", label: "Center"},
		{constant: "Qt::AlignBottom", label: "Bottom"},
		{constant: "Qt::AlignBaseline", label: "Baseline"},
	];

	const enumCursorMoveStyle = [
		{constant: "Qt::LogicalMoveStyle", label: "Logical Move Style", description: "Within a left-to-right text block, decrease cursor position when pressing left arrow key, increase cursor position when pressing the right arrow key. If the text block is right-to-left, the opposite behavior applies."},
		{constant: "Qt::VisualMoveStyle", label: "Visual Move Style", description: "Pressing the left arrow key will always cause the cursor to move left, regardless of the text's writing direction. Pressing the right arrow key will always cause the cursor to move right."},
	];

	const enumSizePolicyPolicy = [
		{constant: "QSizePolicy::Fixed", label: "Fixed", description: "The QWidget::sizeHint() is the only acceptable alternative, so the widget can never grow or shrink (e.g. the vertical direction of a push button)."},
		{constant: "QSizePolicy::Minimum", label: "Minimum", description: "The sizeHint() is minimal, and sufficient. The widget can be expanded, but there is no advantage to it being larger (e.g. the horizontal direction of a push button). It cannot be smaller than the size provided by sizeHint()."},
		{constant: "QSizePolicy::Maximum", label: "Maximum", description: "The sizeHint() is a maximum. The widget can be shrunk any amount without detriment if other widgets need the space (e.g. a separator line). It cannot be larger than the size provided by sizeHint()."},
		{constant: "QSizePolicy::Preferred", label: "Preferred", description: "The sizeHint() is best, but the widget can be shrunk and still be useful. The widget can be expanded, but there is no advantage to it being larger than sizeHint() (the default QWidget policy)."},
		{constant: "QSizePolicy::Expanding", label: "Expanding", description: "The sizeHint() is a sensible size, but the widget can be shrunk and still be useful. The widget can make use of extra space, so it should get as much space as possible (e.g. the horizontal direction of a horizontal slider)."},
		{constant: "QSizePolicy::MinimumExpanding", label: "Minimum Expanding", description: "The sizeHint() is minimal, and sufficient. The widget can make use of extra space, so it should get as much space as possible (e.g. the horizontal direction of a horizontal slider)."},
		{constant: "QSizePolicy::Ignored", label: "Ignored", description: "The sizeHint() is ignored. The widget will get as much space as possible."},
	];

	class QLayout {
		constructor() {
			/** @type {QWidget} */
			this.widget = null;

			this.layoutName = "";

			this.marginLeft = 9;
			this.marginTop = 9;
			this.marginRight = 9;
			this.marginBottom = 9;

			this.layoutSpacing = 6;

			this.propertyNameMapping = {
				"leftMargin": "marginLeft",
				"topMargin": "marginTop",
				"rightMargin": "marginRight",
				"bottomMargin": "marginBottom",
				"spacing": "layoutSpacing",
			};
		}

		update() {
			for (const className of [...this.widget.element.classList]) {
				if (className.startsWith("qt-layout")) {
					this.widget.element.classList.remove(className);
				}
			}
			this.widget.element.classList.add("qt-layout");
			this.widget.element.style.paddingLeft = this.marginLeft + "px";
			this.widget.element.style.paddingRight = this.marginRight + "px";
			this.widget.element.style.paddingTop = this.marginTop + "px";
			this.widget.element.style.paddingBottom = this.marginBottom + "px";
			this.widget.element.style.gap = this.layoutSpacing + "px";

			for (const child of this.widget.children) {
				child.element.style.left = null;
				child.element.style.top = null;
				child.element.style.minWidth = null;
				child.element.style.minHeight = null;
				child.element.style.width = null;
				child.element.style.height = null;
				child.element.style.maxWidth = null;
				child.element.style.maxHeight = null;
				child.element.style.flexGrow = null;
				child.element.style.flexShrink = null;
			}
		}

		getDefaultProps() {
			return [
				{ layout: true, name: "layoutName", type: "string", default: "", label: "Name" },
				{ layout: true, name: "marginLeft", type: "number", default: 9, label: "Margin Left" },
				{ layout: true, name: "marginTop", type: "number", default: 9, label: "Margin Top" },
				{ layout: true, name: "marginRight", type: "number", default: 9, label: "Margin Right" },
				{ layout: true, name: "marginBottom", type: "number", default: 9, label: "Margin Bottom" },
				{ layout: true, name: "layoutSpacing", type: "number", default: 6, label: "Spacing" },
			];
		}

		exportProperties(doc) {
			return [
				createXMLBasicProperty(doc, "leftMargin", "number", this.marginLeft),
				createXMLBasicProperty(doc, "topMargin", "number", this.marginTop),
				createXMLBasicProperty(doc, "rightMargin", "number", this.marginRight),
				createXMLBasicProperty(doc, "bottomMargin", "number", this.marginBottom),
				createXMLBasicProperty(doc, "spacing", "number", this.layoutSpacing),
			];
		}
	}

	/**
	 * Very basic QBoxLayout simulation
	 * 
	 * Original: https://github.com/qt/qtbase/blob/dev/src/widgets/kernel/qboxlayout.cpp
	 */
	class QBoxLayout extends QLayout {
		constructor(orientation = "Qt::Horizontal") {
			super();

			this.orientation = orientation;
		}

		update() {
			super.update();

			this.widget.element.classList.add("qt-layout-box");
			
			if (this.orientation == "Qt::Horizontal") {
				this.widget.element.classList.add("qt-layout-box-horizontal");
			} else {
				this.widget.element.classList.add("qt-layout-box-vertical");
			}

			for (const child of this.widget.children) {
				const policy = child.sizePolicy();
				const sizeHint = child.sizeHint();
				const size = {
					width: sizeHint.width,
					height: sizeHint.height,
				};
				for (const e of [
					{policy: policy.horizontal, normal: "width", min: "minWidth", max: "maxWidth", hint: size.width, main: this.orientation == "Qt::Horizontal"},
					{policy: policy.vertical, normal: "height", min: "minHeight", max: "maxHeight", hint: size.height, main: this.orientation == "Qt::Vertical"},
				]) {
					if (e.policy == "QSizePolicy::Fixed") {
						child.element.style[e.normal] = e.hint + "px";
						if (e.main) {
							child.element.style.flexShrink = "0";
							child.element.style.flexGrow = "0";
						}
					} else if (e.policy == "QSizePolicy::Minimum") {
						child.element.style[e.min] = e.hint + "px";
						if (e.main) {
							child.element.style.flexShrink = "0";
							child.element.style.flexGrow = "1";
						}
					} else if (e.policy == "QSizePolicy::Maximum") {
						child.element.style[e.max] = e.hint + "px";
						if (e.main) {
							child.element.style.flexShrink = "0";
						}
					} else if (e.policy == "QSizePolicy::Preferred") {
						if (e.main) {
							child.element.style.flexGrow = "1";
							child.element.style.flexShrink = "0";
						}
					} else if (e.policy == "QSizePolicy::Expanding") {
						child.element.style[e.normal] = "100%";
					} else if (e.policy == "QSizePolicy::MinimumExpanding") {
						child.element.style[e.min] = e.hint + "px";
						child.element.style[e.normal] = "100%";
					} else if (e.policy == "QSizePolicy::Ignored") {
						if (e.main) {
							child.element.style.flexShrink = "1";
							child.element.style.flexGrow = "1";
						}
					}
				}
			}
		}
	}

	class QVBoxLayout extends QBoxLayout {
		constructor() {
			super("Qt::Vertical");
		}
	}

	class QHBoxLayout extends QBoxLayout {
		constructor() {
			super("Qt::Horizontal");
		}
	}

	class QWidget {
		constructor() {
			this.element = document.createElement("div");
			this.parent = null;
			/** @type {QWidget[]} */
			this.children = [];
			this._name = "";
			this.root = false;
			this.props = {};

			this.sizePolicyHorizontal = null;
			this.sizePolicyVertical = null;
			this.layout = null;
		
			this.element.classList.add("QWidget");

			this.element.addEventListener("mousedown", this.mouseDown.bind(this));

			this._drag = null;
			this._dragElement = null;

			this._selectionElement = null;
			this._selectionElementTopLeft = null;
			this._selectionElementTopRight = null;
			this._selectionElementTop = null;
			this._selectionElementLeft = null;
			this._selectionElementRight = null;
			this._selectionElementBottom = null;
			this._selectionElementBottomLeft = null;
			this._selectionElementBottomRight = null;

			this.inspectorElement = document.createElement("li");
			this.inspectorElementLabel = document.createElement("div");
			this.inspectorElementContainer = document.createElement("ul");
			this.inspectorElementLabel.classList.add("inspector-element-label");
			this.inspectorElementLabel.addEventListener("click", () => {
				setCurrentSelection(this);
			});
			this.inspectorElementLabelName = document.createElement("span");
			this.inspectorElementLabelClass = document.createElement("span");
			this.inspectorElementLabelClass.textContent = this.constructor.name;
			this.inspectorElementLabelClass.classList.add("inspector-element-label-class");
			this.inspectorElementLabel.appendChild(this.inspectorElementLabelName);
			this.inspectorElementLabel.appendChild(this.inspectorElementLabelClass);
			this.inspectorElement.appendChild(this.inspectorElementLabel);
			this.inspectorElement.appendChild(this.inspectorElementContainer);

			this._propertyEditorProperties = {};
		}

		addBasicPropGetterSetters(props, afterChange) {
			for (const prop of props) {
				this['getProp_' + prop] = () => {
					return this[prop];
				};
				this['setProp_' + prop] = (newValue) => {
					this[prop] = newValue;
					afterChange.bind(this)();
					this.invalidateProperty(prop);
				};
			}
		}

		defaultSizePolicy() {
			return {
				horizontal: "QSizePolicy::Preferred",
				vertical: "QSizePolicy::Preferred",
			};
		}

		sizePolicy() {
			return {
				horizontal: this.sizePolicyHorizontal ?? this.defaultSizePolicy().horizontal,
				vertical: this.sizePolicyVertical ?? this.defaultSizePolicy().vertical,
			};
		}

		sizeHint() {
			const cloned = this.element.cloneNode(true);
			document.body.appendChild(cloned);
			cloned.style.position = "absolute";
			cloned.style.width = "fit-content";
			cloned.style.height = "fit-content";
			const rect = cloned.getBoundingClientRect();
			cloned.remove();
			return {
				width: rect.width,
				height: rect.height
			};
		}

		getDefaultProps() {
			return [
				{ separator: "QWidget" },
				{name: "name", type: "string", label: "Name"},
				...(this.root ? [
					{name: "windowTitle", type: "string", default: "", label: "Window Title"}
				] : [
					...(this.parent == null || this.parent.layout == null ? [
						{name: "x", type: "number", default: 0, label: "X"},
						{name: "y", type: "number", default: 0, label: "Y"},
					] : []),
				]),
				...(this.parent == null || this.parent.layout == null ? [
					{name: "width", type: "number", default: 100, label: "Width"},
					{name: "height", type: "number", default: 100, label: "Height"},
				] : [
					{name: "sizePolicyHorizontal", type: "enum", default: this.defaultSizePolicy().horizontal, label: "Size Policy Horizontal", options: enumSizePolicyPolicy},
					{name: "sizePolicyVertical", type: "enum", default: this.defaultSizePolicy().vertical, label: "Size Policy Vertical", options: enumSizePolicyPolicy},
				]),
			];
		}
		getFullDefaultProps() {
			return [
				...this.getDefaultProps(),
				...(this.layout != null ? [
					{ separator: "Layout ("+this.layout.constructor.name+")" },
					...this.layout.getDefaultProps(),
				] : []),
			];
		}

		get name() {
			return this._name;
		}

		set name(newValue) {
			this._name = newValue;
			this.inspectorElementLabelName.textContent = this._name;
			this.invalidateProperty("name");
		}

		setLayout(newLayout) {
			this.layout = newLayout;
			newLayout.widget = this;
			this.recalculate();
		}

		free() {
			if (currentSelection == this) {
				setCurrentSelection(null);
			}
			for (const child of this.children) {
				child.free();
			}
			this.element.remove();
			this.inspectorElement.remove();
			if (this.parent !== null) {
				this.children.splice(this.children.indexOf(this), 1);
			}
		}

		mouseDown(/** @type{MouseEvent} */ event) {
			setCurrentSelection(this);
			if (this.root) { return; }
			this._drag = {
				x: event.screenX,
				y: event.screenY,
				isDragging: false
			};

			this._dragElement = document.createElement("div");
			this._dragElement.classList.add("drag-overlay");
			this._dragElement.addEventListener("mousemove", this.mouseMove.bind(this));
			this._dragElement.addEventListener("mouseup", this.mouseUp.bind(this));
			document.body.appendChild(this._dragElement);

			event.stopPropagation();
		}

		mouseMove(/** @type{MouseEvent} */ event) {
			if (this._drag === null) { return; }

			const diffX = event.screenX - this._drag.x;
			const diffY = event.screenY - this._drag.y;

			if (!this._drag.isDragging) {
				if (Math.sqrt(diffX * diffX + diffY * diffY) < 5) {
					event.stopPropagation();
					return;
				}
				this._drag.isDragging = true;
				this.element.classList.add("dragging");
				this._dragElement.classList.add("active");
				if (this._selectionElement !== null) {
					this._selectionElement.style.display = "none";
				}
			}

			const position = this.getPosition();
			this.setPosition(
				position.x + diffX,
				position.y + diffY,
			);

			this._drag.x = event.screenX;
			this._drag.y = event.screenY;

			event.stopPropagation();
		}

		mouseUp(/** @type{MouseEvent} */ event) {
			if (this._drag === null) { return; }

			if (this._drag.isDragging) {
				const position = this.getPosition();
	
				this.setPosition(
					Math.round(position.x / 10) * 10,
					Math.round(position.y / 10) * 10,
				);

				if (this._selectionElement !== null) {
					this._selectionElement.style.display = "block";
				}

				save();
			}

			this._drag = null;
			this.element.classList.remove("dragging");
			this._dragElement.remove();

			event.stopPropagation();
		}

		selectionMouseDown(selectionDot, change, /** @type{MouseEvent} */ event) {
			const position = this.getPosition();
			const size = this.getSize();

			this._drag = {
				x: event.screenX,
				y: event.screenY,
				change: change,
				position: position,
				size: size
			};

			this._dragElement = document.createElement("div");
			this._dragElement.classList.add("drag-overlay");
			this._dragElement.style.cursor = window.getComputedStyle(selectionDot).cursor;
			this._dragElement.addEventListener("mousemove", this.selectionMouseMove.bind(this));
			this._dragElement.addEventListener("mouseup", this.selectionMouseUp.bind(this));
			document.body.appendChild(this._dragElement);

			event.stopPropagation();
			event.preventDefault();
		}

		selectionMouseMove(/** @type{MouseEvent} */ event) {
			if (this._drag === null) {
				return;
			}

			let diffX = Math.round((event.screenX - this._drag.x) / 10) * 10;
			let diffY = Math.round((event.screenY - this._drag.y) / 10) * 10;
			if (diffX > this._drag.size.width - 20 && this._drag.change[2] < 0) {
				diffX = this._drag.size.width - 20;
			}
			if (diffY > this._drag.size.height - 20 && this._drag.change[3] < 0) {
				diffY = this._drag.size.height - 20;
			}
			this.setPosition(
				this._drag.position.x + diffX * this._drag.change[0],
				this._drag.position.y + diffY * this._drag.change[1],
			);
			this.setSize(
				this._drag.size.width + diffX * this._drag.change[2],
				this._drag.size.height + diffY * this._drag.change[3],
			);

			event.stopPropagation();
		}

		selectionMouseUp(/** @type{MouseEvent} */ event) {
			if (this._drag === null) {
				return;
			}

			this._drag = null;
			this._dragElement.remove();

			save();

			event.stopPropagation();
		}

		_unselect() {
			this._selectionElement.remove();
			this.inspectorElementLabel.classList.remove("inspector-element-label-selected");
			document.getElementById("propertyEditorProperties").textContent = "";
		}

		_select() {
			this._selectionElement = document.createElement("div");
			this._selectionElement.classList.add("selection");
			let dots = {'Right': [0,0,1,0], 'Bottom': [0,0,0,1], 'BottomRight': [0,0,1,1]};
			if (!this.root) {
				dots = {...dots,'Top': [0,1,0,-1], 'TopLeft': [1,1,-1,-1], 'TopRight': [0,1,1,-1], 'Left': [1,0,-1,0], 'BottomLeft': [1,0,-1,1]};
			}
			for (const [dot, change] of Object.entries(dots)) {
				const selectionDot = document.createElement("div");
				selectionDot.classList.add("selection-dot");
				selectionDot.classList.add("selection-dot-" + dot);
				if (this.parent == null || this.parent.layout == null) {
					selectionDot.addEventListener("mousedown", this.selectionMouseDown.bind(this, selectionDot, change));
				} else {
					selectionDot.classList.add("selection-disabled");
				}
				this._selectionElement.appendChild(selectionDot);

				this['_selectionElement' + dot] = selectionDot;
			}
			document.body.appendChild(this._selectionElement);
			this._updateSelection();

			this.inspectorElementLabel.classList.add("inspector-element-label-selected");

			this._updateProperties();
		}

		_updateSelection() {
			if (this._selectionElement === null) {
				return;
			}
			const rect = this.element.getBoundingClientRect();
			if (!this.root) {
				this._selectionElementTop.style.left = rect.left + rect.width / 2 + "px";
				this._selectionElementTop.style.top = rect.top + "px";
	
				this._selectionElementLeft.style.left = rect.left + "px";
				this._selectionElementLeft.style.top = rect.top + rect.height / 2 + "px";

				this._selectionElementTopLeft.style.left = rect.left + "px";
				this._selectionElementTopLeft.style.top = rect.top + "px";
	
				this._selectionElementTopRight.style.left = rect.right + "px";
				this._selectionElementTopRight.style.top = rect.top + "px";
	
				this._selectionElementBottomLeft.style.left = rect.left + "px";
				this._selectionElementBottomLeft.style.top = rect.bottom + "px";
			}

			this._selectionElementBottomRight.style.left = rect.right + "px";
			this._selectionElementBottomRight.style.top = rect.bottom + "px";

			this._selectionElementBottom.style.left = rect.left + rect.width / 2 + "px";
			this._selectionElementBottom.style.top = rect.bottom + "px";

			this._selectionElementRight.style.left = rect.right + "px";
			this._selectionElementRight.style.top = rect.top + rect.height / 2 + "px";
		}

		_updateProperties() {
			const propertyEditorProperties = document.getElementById("propertyEditorProperties");
			propertyEditorProperties.textContent = "";

			const defaultProps = this.getFullDefaultProps();
			for (const defaultProp of defaultProps) {
				if (defaultProp.separator != null) {
					const separatorElement = document.createElement("tr");
					separatorElement.classList.add("property-editor-separator");
					const separatorLabelElement = document.createElement("td");
					separatorLabelElement.colSpan = 2;
					separatorLabelElement.classList.add("property-editor-separator-label");
					separatorLabelElement.textContent = defaultProp.separator;
					separatorElement.appendChild(separatorLabelElement);
					propertyEditorProperties.appendChild(separatorElement);
					continue;
				}

				const propElement = document.createElement("tr");
				const propNameElement = document.createElement("td");
				const propValueElement = document.createElement("td");
				
				propElement.classList.add("property-editor-property");

				propNameElement.classList.add("property-editor-property-name");
				propNameElement.textContent = defaultProp.label ?? defaultProp.name;
				propNameElement.setAttribute("title", defaultProp.name);

				propValueElement.classList.add("property-editor-property-value");

				const propertyEditorProperty = {
					type: defaultProp.type,
					layout: defaultProp.layout === true,
				};

				const set = (value) => {
					if (propertyEditorProperty.layout) {
						this.layout[defaultProp.name] = value;
						this.layout.update();
					} else {
						this.setProperty(defaultProp.name, value);
					}
					save();
				};

				if (defaultProp.type == "string" || defaultProp.type == "number") {
					const input = document.createElement("input");
					input.type = {
						"string": "text",
						"number": "number"
					}[defaultProp.type];
					input.addEventListener("change", () => {
						let newValue = input.value;
						if (defaultProp.type === "number") {
							newValue = parseInt(newValue);
						}
						set(newValue);
					});
					propValueElement.appendChild(input);
					propertyEditorProperty.input = input;
				} else if (defaultProp.type == "enum") {
					const select = document.createElement("select");
					for (const option of defaultProp.options) {
						const optionElement = document.createElement("option");
						optionElement.value = option.constant;
						optionElement.textContent = option.label;
						if (option.description != null) {
							optionElement.title = option.description;
						}
						select.appendChild(optionElement);
					}
					select.addEventListener("change", () => {
						let newValue = select.value;
						set(newValue);
					});
					propValueElement.appendChild(select);
					propertyEditorProperty.input = select;
				} else if (defaultProp.type == "bool") {
					const input = document.createElement("input");
					input.type = "checkbox";
					input.addEventListener("change", () => {
						set(input.checked);
					});
					propValueElement.appendChild(input);
					propertyEditorProperty.input = input;
				}
				this._propertyEditorProperties[defaultProp.name] = propertyEditorProperty;
				this.invalidateProperty(defaultProp.name);

				propElement.appendChild(propNameElement);
				propElement.appendChild(propValueElement);
				propertyEditorProperties.appendChild(propElement);
			}
		}

		invalidateProperty(name) {
			if (currentSelection !== this) {
				return;
			}
			const propertyEditorItem = this._propertyEditorProperties[name];
			if (propertyEditorItem == null) {
				return;
			}
			let value = null;
			if (propertyEditorItem.layout) {
				value = this.layout[name];
			} else {
				value = this.getProperty(name);
			}
			if (propertyEditorItem.type == "bool") {
				propertyEditorItem.input.checked = value;
			} else {
				propertyEditorItem.input.value = value;
			}

		}

		getPosition() {
			return {
				x: parseInt(this.element.style.left.replaceAll("px","")),
				y: parseInt(this.element.style.top.replaceAll("px","")),
			};
		}

		getSize() {
			return {
				width: parseInt(this.element.style.width.replaceAll("px","")),
				height: parseInt(this.element.style.height.replaceAll("px","")),
			};
		}

		setPosition(x, y) {
			this.element.style.left = `${x}px`;
			this.element.style.top = `${y}px`;
			this._updateSelection();
			this.invalidateProperty("x");
			this.invalidateProperty("y");
		}

		setSize(width, height) {
			this.element.style.width = `${width}px`;
			this.element.style.height = `${height}px`;
			this._updateSelection();
			this.invalidateProperty("width");
			this.invalidateProperty("height");
		}

		/* Not real props */
		setProp_x(x) {
			this.setPosition(x, this.getPosition().y);
		}
		setProp_y(y) {
			this.setPosition(this.getPosition().x, y);
		}
		setProp_width(width) {
			this.setSize(width, this.getSize().height);
		}
		setProp_height(height) {
			this.setSize(this.getSize().width, height);
		}
		setProp_name(name) {
			this.name = name;
		}
		setProp_sizePolicyHorizontal(value) {
			this.sizePolicyHorizontal = value;
			this.parent?.recalculate();
			this._updateSelection();
		}
		setProp_sizePolicyVertical(value) {
			this.sizePolicyVertical = value;
			this.parent?.recalculate();
			this._updateSelection();
		}

		getProp_x() {
			return this.getPosition().x;
		}
		getProp_y() {
			return this.getPosition().y;
		}
		getProp_width() {
			return this.getSize().width;
		}
		getProp_height() {
			return this.getSize().height;
		}
		getProp_name() {
			return this.name;
		}
		getProp_sizePolicyHorizontal() {
			return this.sizePolicy().horizontal;
		}
		getProp_sizePolicyVertical() {
			return this.sizePolicy().vertical;
		}
		/******************/

		setProp_geometry(value) {
			this.setPosition(value.x, value.y);
			this.setSize(value.width, value.height);
		}

		setProp_sizePolicy(value) {
			this.sizePolicyHorizontal = value.horizontal;
			this.sizePolicyVertical = value.vertical;
			this.recalculate();
		}

		setPropertyFromElement(/** @type {Element} */ element) {
			const { name, value } = getDataFromXMLProperty(element);
			this.setProperty(name, value);
		}

		setProperty(name, value) {
			const setter = this[`setProp_${name}`];
			if (setter !== undefined) {
				setter.bind(this)(value);
			} else {
				this.props[name] = value;
				this.invalidateProperty(name);
			}
		}
		getProperty(name) {
			const getter = this[`getProp_${name}`];
			if (getter !== undefined) {
				return getter.bind(this)();
			} else if (this.props.hasOwnProperty(name)) {
				return this.props[name];
			} else {
				return this.getFullDefaultProps().find((x) => x.name === name).default;
			}
		}

		addChild(child) {
			child.parent = this;
			this.children.push(child);

			this.element.appendChild(child.element);

			this.inspectorElementContainer.appendChild(child.inspectorElement);

			this.recalculate();
		}

		recalculate() {
			let parent = this.parent;
			let parentAmount = 0;
			while (parent !== null) {
				parentAmount += 1;
				parent = parent.parent;
			}
			this.inspectorElementLabel.style.paddingLeft = (12 + parentAmount * 12) + "px";

			for (const child of this.children) {
				child.recalculate();
			}

			if (this.layout != null) {
				this.layout.update();
			}
		}

		export(/** @type{XMLDocument} */ doc) {
			const element = doc.createElement("widget");
			element.setAttribute("class", this.constructor.name);
			element.setAttribute("name", this.name);
			const properties = this.exportProperties(doc);
			for (const property of properties) {
				if (property === null) {
					continue;
				}
				element.appendChild(property);
			}
			let layoutElement = null;
			if (this.layout != null) {
				layoutElement = doc.createElement("layout");
				layoutElement.setAttribute("class", this.layout.constructor.name);
				if (this.layout.name != "") {
					layoutElement.setAttribute("name", this.layout.name);
				}
				const layoutProperties = this.layout.exportProperties(doc);
				for (const property of layoutProperties) {
					layoutElement.appendChild(property);
				}
				element.appendChild(layoutElement);
			}

			for (const child of this.children) {
				if (this.layout != null) {
					const itemElement = doc.createElement("item");
					itemElement.appendChild(child.export(doc));
					layoutElement.appendChild(itemElement);
				} else {
					element.appendChild(child.export(doc));
				}
			}
			return element;
		}

		exportProperties(/** @type{XMLDocument} */ doc) {
			const properties = [];
			for (const [key, value] of Object.entries(this.props)) {
				const property = doc.createElement("property");
				property.setAttribute("name", key);
				let type = typeof value;
				if (type == "boolean") {
					type = "bool";
				}
				const propertyValue = doc.createElement(type);
				propertyValue.textContent = value.toString();
				property.appendChild(propertyValue);
				properties.push(property);
			}
			if (this.parent == null || this.parent.layout === null) {
				const property = doc.createElement("property");
				property.setAttribute("name", "geometry");
				const propertyValue = doc.createElement("rect");
				const x = doc.createElement("x");
				const y = doc.createElement("y");
				const width = doc.createElement("width");
				const height = doc.createElement("height");
				const position = this.getPosition();
				const size = this.getSize();
				x.textContent = position.x;
				y.textContent = position.y;
				width.textContent = size.width;
				height.textContent = size.height;
				propertyValue.appendChild(x);
				propertyValue.appendChild(y);
				propertyValue.appendChild(width);
				propertyValue.appendChild(height);
				property.appendChild(propertyValue);
				properties.push(property);
			} else if (this.sizePolicyHorizontal != null && this.sizePolicyVertical != null) {
				const property = doc.createElement("property");
				property.setAttribute("name", "sizePolicy");
				const propertyValue = doc.createElement("sizepolicy");
				propertyValue.setAttribute("hsizetype", this.sizePolicyHorizontal.split(":").pop());
				propertyValue.setAttribute("vsizetype", this.sizePolicyVertical.split(":").pop());
				const horstretch = doc.createElement("horstretch");
				const verstretch = doc.createElement("verstretch");
				horstretch.textContent = 0;
				verstretch.textContent = 0;
				propertyValue.appendChild(horstretch);
				propertyValue.appendChild(verstretch);
				property.appendChild(propertyValue);
				properties.push(property);
			}
			return properties;
		}

		setAsRoot() {
			this.root = true;
			document.querySelector(".main").replaceChildren(this.element);
			document.getElementById("objectInspectorRoot").appendChild(this.inspectorElement);
			this.recalculate();
		}
	}

	class QAbstractButton extends QWidget {
		constructor() {
			super();
			this.element.classList.add("QAbstractButton");

			this.iconElement = document.createElement("div");
			this.element.appendChild(this.iconElement);

			this.textElement = document.createElement("span");
			this.element.appendChild(this.textElement);
		}

		defaultSizePolicy() {
			return {
				horizontal: "QSizePolicy::Minimum",
				vertical: "QSizePolicy::Fixed",
			};
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QAbstractButton" },
				{ name: "text", type: "string", default: "", label: "Text" }
			];
		}

		setProp_text(value) {
			this.textElement.innerText = value;
			this.invalidateProperty('text');
		}

		getProp_text() {
			return this.textElement.innerText;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			const textProperty = doc.createElement("property");
			textProperty.setAttribute("name", "text");
			const textPropertyValue = doc.createElement("string");
			textPropertyValue.textContent = this.textElement.innerText;
			textProperty.appendChild(textPropertyValue);
			return [
				...props,
				textProperty
			];
		}
	}

	class QPushButton extends QAbstractButton {
		constructor() {
			super();
			this.element.classList.add("QPushButton");
		}
	}

	class QProgressBar extends QWidget {
		constructor() {
			super();
			this.element.classList.add("QProgressBar");

			this.progressElement = document.createElement("div");
			this.element.appendChild(this.progressElement);

			this.textElement = document.createElement("span");
			this.element.appendChild(this.textElement);

			this.value = 0;
			this.minimum = 0;
			this.maximum = 100;
			this.format = "%p%";
		}

		sizeHint() {
			return {
				width: 91,
				height: 24,
			};
		}

		defaultSizePolicy() {
			return {
				horizontal: "QSizePolicy::Expanding",
				vertical: "QSizePolicy::Fixed",
			};
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QProgressBar" },
				{ name: "minimum", type: "number", default: 0, label: "Minimum" },
				{ name: "maximum", type: "number", default: 100, label: "Maximum" },
				{ name: "value", type: "number", default: 24, label: "Value" },
				{ name: "format", type: "string", default: "%p%", label: "Format" },
			];
		}

		updateDisplay() {
			const translatedValue = this.value - this.minimum;
			const translatedMaximum = this.maximum - this.minimum;
			const percent = Math.floor((translatedValue / translatedMaximum) * 100);

			this.textElement.textContent = this.format.replace("%p", percent).replace("%v", this.value).replace("%m", translatedMaximum);

			this.progressElement.style.width = percent + "%";
		}

		setProp_value(value) {
			this.value = value;
			this.updateDisplay();
			this.invalidateProperty('value');
		}
		setProp_minimum(value) {
			this.minimum = value;
			this.updateDisplay();
			this.invalidateProperty('minimum');
		}
		setProp_maximum(value) {
			this.maximum = value;
			this.updateDisplay();
			this.invalidateProperty('maximum');
		}
		setProp_format(value) {
			this.format = value;
			this.updateDisplay();
			this.invalidateProperty('format');
		}
		getProp_value() {
			return this.value;
		}
		getProp_minimum() {
			return this.minimum;
		}
		getProp_maximum() {
			return this.maximum;
		}
		getProp_format() {
			return this.format;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			return [
				...props,
				createXMLBasicProperty(doc, "value", "number", this.value),
				this.minimum === 0 ? null : createXMLBasicProperty(doc, "minimum", "number", this.minimum),
				this.maximum === 100 ? null : createXMLBasicProperty(doc, "maximum", "number", this.maximum),
				this.format === "%p%" ? null : createXMLBasicProperty(doc, "format", "string", this.format),
			];
		}
	}

	class QFrame extends QWidget {
		static enumShape = [
			{ constant: "QFrame::NoFrame", label: "No Frame", description: "Draws nothing around its contents" },
			{ constant: "QFrame::Box", label: "Box", description: "Draws a box around its contents" },
			{ constant: "QFrame::Panel", label: "Panel", description: "Draws a panel to make the contents appear raised or sunken" },
			{ constant: "QFrame::StyledPanel", label: "Styled Panel", description: "Draws a rectangular panel with a look that depends on the current GUI style" },
			{ constant: "QFrame::HLine", label: "Horizontal Line", description: "Draws a horizontal line that frames nothing (useful as separator)" },
			{ constant: "QFrame::VLine", label: "Vertical Line", description: "Draws a vertical line that frames nothing (useful as separator)" },
			{ constant: "QFrame::WinPanel", label: "WinPanel (legacy)", description: "Draws a rectangular panel that can be raised or sunken like those in Windows 2000. Specifying this shape sets the line width to 2 pixels. WinPanel is provided for compatibility. For GUI style independence we recommend using StyledPanel instead." },
		];

		static enumShadow = [
			{ constant: "QFrame::Plain", label: "Plain", description: "The frame and contents appear level with the surroundings; draws using the palette QPalette::WindowText color (without any 3D effect)" },
			{ constant: "QFrame::Raised", label: "Raised", description: "The frame and contents appear raised; draws a 3D raised line using the light and dark colors of the current color group" },
			{ constant: "QFrame::Sunken", label: "Sunken", description: "The frame and contents appear sunken; draws a 3D sunken line using the light and dark colors of the current color group" },
		];

		constructor() {
			super();
			this.element.classList.add("QFrame");

			this.frameShape = "QFrame::NoFrame";
			this.frameShadow = "QFrame::Plain";
			this.lineWidth = 1;
			this.midLineWidth = 0;

			this.updateDisplay();
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QFrame" },
				{ name: "frameShape", type: "enum", default: "QFrame::NoFrame", label: "Frame Shape", options: QFrame.enumShape },
				{ name: "frameShadow", type: "enum", default: "QFrame::Plain", label: "Frame Shadow", options: QFrame.enumShadow },
				{ name: "lineWidth", type: "number", default: 1, label: "Line Width" },
				{ name: "midLineWidth", type: "number", default: 0, label: "Mid-line Width" },
			];
		}

		updateDisplay() {
			for (const className of [...this.element.classList]) {
				if (className.startsWith("QFrame-")) {
					this.element.classList.remove(className);
				}
			}
			this.element.style.setProperty("--QFrame-line-width", this.lineWidth + "px");
			this.element.style.setProperty("--QFrame-mid-line-width", this.midLineWidth + "px");
			this.element.classList.add(this.frameShape.replaceAll("::", "-"));
			this.element.classList.add(this.frameShadow.replaceAll("::", "-"));
		}

		setProp_frameShape(value) {
			this.frameShape = value;
			this.updateDisplay();
			this.invalidateProperty('frameShape');
		}
		setProp_frameShadow(value) {
			this.frameShadow = value;
			this.updateDisplay();
			this.invalidateProperty('frameShadow');
		}
		setProp_lineWidth(value) {
			this.lineWidth = value;
			this.updateDisplay();
			this.invalidateProperty('lineWidth');
		}
		setProp_midLineWidth(value) {
			this.midLineWidth = value;
			this.updateDisplay();
			this.invalidateProperty('midLineWidth');
		}
		getProp_frameShape() {
			return this.frameShape;
		}
		getProp_frameShadow() {
			return this.frameShadow;
		}
		getProp_lineWidth() {
			return this.lineWidth;
		}
		getProp_midLineWidth() {
			return this.midLineWidth;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			return [
				...props,
				this.frameShape === "QFrame::NoFrame" ? null : createXMLBasicProperty(doc, "frameShape", "enum", this.frameShape),
				this.frameShadow === "QFrame::Plain" ? null : createXMLBasicProperty(doc, "frameShadow", "enum", this.frameShadow),
				this.lineWidth === 1 ? null : createXMLBasicProperty(doc, "lineWidth", "number", this.lineWidth),
				this.midLineWidth === 0 ? null : createXMLBasicProperty(doc, "midLineWidth", "number", this.midLineWidth),
			];
		}
	}

	class QLabel extends QFrame {
		constructor() {
			super();
			this.element.classList.add("QLabel");

			this.text = "";
			this.wordWrap = false;
			this.alignmentHorizontal = "Qt::AlignLeft";
			this.alignmentVertical = "Qt::AlignVCenter";

			this.updateLabelDisplay();
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QLabel" },
				{ name: "text", type: "string", default: "", label: "Text" },
				{ name: "wordWrap", type: "bool", default: false, label: "Word Wrap" },
				{ name: "alignmentHorizontal", type: "enum", default: "Qt::AlignLeft", label: "Alignment Horizontal", options: enumAlignmentHorizontal },
				{ name: "alignmentVertical", type: "enum", default: "Qt::AlignVCenter", label: "Alignment Vertical", options: enumAlignmentVertical },
			];
		}

		updateLabelDisplay() {
			this.element.textContent = this.text;

			this.element.style.whiteSpace = this.wordWrap ? "pre-wrap" : "pre";

			if (this.alignmentHorizontal == "Qt::AlignLeft" || this.alignmentHorizontal == "Qt::AlignJustify") {
				this.element.style.justifyContent = "left";
				this.element.style.textAlign = "left";
			} else if (this.alignmentHorizontal == "Qt::AlignHCenter") {
				this.element.style.justifyContent = "center";
				this.element.style.textAlign = "center";
			} else if (this.alignmentHorizontal == "Qt::AlignRight") {
				this.element.style.justifyContent = "right";
				this.element.style.textAlign = "right";
			}
			if (this.alignmentVertical == "Qt::AlignTop") {
				this.element.style.alignItems = "start";
			} else if (this.alignmentVertical == "Qt::AlignVCenter" || this.alignmentVertical == "Qt::AlignBaseline") {
				this.element.style.alignItems = "center";
			} else if (this.alignmentVertical == "Qt::AlignBottom") {
				this.element.style.alignItems = "end";
			}
		}

		setProp_text(value) {
			this.text = value;
			this.updateLabelDisplay();
		}
		setProp_alignment(value) {
			for (const item of value.split("|")) {
				if (enumAlignmentHorizontal.find((x) => x.constant == item) != null) {
					this.alignmentHorizontal = item;
				} else if (enumAlignmentVertical.find((x) => x.constant == item) != null) {
					this.alignmentVertical = item;
				}
			}
			this.updateLabelDisplay();
		}
		setProp_alignmentHorizontal(value) {
			this.alignmentHorizontal = value;
			this.updateLabelDisplay();
		}
		setProp_alignmentVertical(value) {
			this.alignmentVertical = value;
			this.updateLabelDisplay();
		}
		setProp_wordWrap(value) {
			this.wordWrap = value;
			this.updateLabelDisplay();
		}

		getProp_text() {
			return this.text;
		}
		getProp_alignment() {
			return `${this.alignmentHorizontal}|${this.alignmentVertical}`;
		}
		getProp_alignmentHorizontal() {
			return this.alignmentHorizontal;
		}
		getProp_alignmentVertical() {
			return this.alignmentVertical;
		}
		getProp_wordWrap() {
			return this.wordWrap;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			return [
				...props,
				this.text === "" ? null : createXMLBasicProperty(doc, "text", "string", this.text),
				createXMLBasicProperty(doc, "wordWrap", "bool", this.wordWrap),
				createXMLBasicProperty(doc, "alignment", "set", this.getProp_alignment()),
			];
		}
	}

	class QLineEdit extends QWidget {
		static enumEchoMode = [
			{ constant: "QLineEdit::Normal", label: "Normal", description: "Display characters as they are entered. This is the default." },
			{ constant: "QLineEdit::NoEcho", label: "No Echo", description: "Do not display anything. This may be appropriate for passwords where even the length of the password should be kept secret." },
			{ constant: "QLineEdit::Password", label: "Password", description: "Display platform-dependent password mask characters instead of the characters actually entered." },
			{ constant: "QLineEdit::PasswordEchoOnEdit", label: "Password Echo On Edit", description: "Display characters only while they are entered. Otherwise, display characters as with Password." },
		];

		constructor() {
			super();
			this.element.classList.add("QLineEdit");

			this.text = "";
			this.frame = true;
			this.alignmentHorizontal = "Qt::AlignLeft";
			this.alignmentVertical = "Qt::AlignVCenter";
			this.placeholderText = "";
			this.clearButtonEnabled = false;
			this.echoMode = "QLineEdit::Normal";
			this.cursorMoveStyle = "Qt::LogicalMoveStyle";

			this.updateDisplay();
		}

		sizeHint() {
			return {
				width: 125,
				height: 24
			};
		}

		defaultSizePolicy() {
			return {
				horizontal: "QSizePolicy::Minimum",
				vertical: "QSizePolicy::Fixed",
			};
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QLineEdit" },
				{ name: "text", type: "string", default: "", label: "Text" },
				{ name: "maxLength", type: "number", default: 32767, label: "Max Length" },
				{ name: "placeholderText", type: "string", default: "", label: "Placeholder Text" },
				{ name: "inputMask", type: "string", default: "", label: "Input Mask" },
				{ name: "echoMode", type: "enum", default: "QLineEdit::Normal", label: "Echo Mode", options: QLineEdit.enumEchoMode },
				{ name: "frame", type: "bool", default: true, label: "Frame" },
				{ name: "alignmentHorizontal", type: "enum", default: "Qt::AlignLeft", label: "Alignment Horizontal", options: enumAlignmentHorizontal },
				{ name: "alignmentVertical", type: "enum", default: "Qt::AlignVCenter", label: "Alignment Vertical", options: enumAlignmentVertical },
				{ name: "dragEnabled", type: "bool", default: false, label: "Drag Enabled" },
				{ name: "readOnly", type: "bool", default: false, label: "Read Only" },
				{ name: "clearButtonEnabled", type: "bool", default: false, label: "Clear Button" },
				{ name: "cursorMoveStyle", type: "enum", default: "Qt::LogicalMoveStyle", label: "Cursor Move Style", options: enumCursorMoveStyle },
			];
		}

		updateDisplay() {
			const isPlaceholder = this.text == "";
			if (isPlaceholder) {
				this.element.textContent = this.placeholderText;
				this.element.classList.add("QLineEdit-placeholder");
			} else {
				if (this.echoMode === "QLineEdit::Password" || this.echoMode === "QLineEdit::PasswordEchoOnEdit") {
					this.element.textContent = "•".repeat(this.text.length);
				} else if (this.echoMode === "QLineEdit::NoEcho") {
					this.element.textContent = "";
				} else {
					this.element.textContent = this.text;
				}
				this.element.classList.remove("QLineEdit-placeholder");
			}

			if (this.frame) {
				this.element.classList.remove("QLineEdit-noframe");
			} else {
				this.element.classList.add("QLineEdit-noframe");
			}

			if (this.clearButtonEnabled) {
				this.element.classList.add("QLineEdit-clearbutton");
			} else {
				this.element.classList.remove("QLineEdit-clearbutton");
			}

			if (this.alignmentHorizontal == "Qt::AlignLeft" || this.alignmentHorizontal == "Qt::AlignJustify") {
				this.element.style.justifyContent = "left";
				this.element.style.textAlign = "left";
			} else if (this.alignmentHorizontal == "Qt::AlignHCenter") {
				this.element.style.justifyContent = "center";
				this.element.style.textAlign = "center";
			} else if (this.alignmentHorizontal == "Qt::AlignRight") {
				this.element.style.justifyContent = "right";
				this.element.style.textAlign = "right";
			}
			if (this.alignmentVertical == "Qt::AlignTop") {
				this.element.style.alignItems = "start";
			} else if (this.alignmentVertical == "Qt::AlignVCenter" || this.alignmentVertical == "Qt::AlignBaseline") {
				this.element.style.alignItems = "center";
			} else if (this.alignmentVertical == "Qt::AlignBottom") {
				this.element.style.alignItems = "end";
			}
		}

		setProp_text(value) {
			this.text = value;
			this.updateDisplay();
		}
		setProp_placeholderText(value) {
			this.placeholderText = value;
			this.updateDisplay();
		}
		setProp_alignment(value) {
			for (const item of value.split("|")) {
				if (enumAlignmentHorizontal.find((x) => x.constant == item) != null) {
					this.alignmentHorizontal = item;
				} else if (enumAlignmentVertical.find((x) => x.constant == item) != null) {
					this.alignmentVertical = item;
				}
			}
			this.updateDisplay();
		}
		setProp_alignmentHorizontal(value) {
			this.alignmentHorizontal = value;
			this.updateDisplay();
		}
		setProp_alignmentVertical(value) {
			this.alignmentVertical = value;
			this.updateDisplay();
		}
		setProp_frame(value) {
			this.frame = value;
			this.updateDisplay();
		}
		setProp_clearButtonEnabled(value) {
			this.clearButtonEnabled = value;
			this.updateDisplay();
		}
		setProp_echoMode(value) {
			this.echoMode = value;
			this.updateDisplay();
		}
		setProp_cursorMoveStyle(value) {
			this.cursorMoveStyle = value;
		}

		getProp_text() {
			return this.text;
		}
		getProp_placeholderText() {
			return this.placeholderText;
		}
		getProp_alignment() {
			return `${this.alignmentHorizontal}|${this.alignmentVertical}`;
		}
		getProp_alignmentHorizontal() {
			return this.alignmentHorizontal;
		}
		getProp_alignmentVertical() {
			return this.alignmentVertical;
		}
		getProp_frame() {
			return this.frame;
		}
		getProp_clearButtonEnabled() {
			return this.clearButtonEnabled;
		}
		getProp_echoMode() {
			return this.echoMode;
		}
		getProp_cursorMoveStyle() {
			return this.cursorMoveStyle;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			return [
				...props,
				this.text === "" ? null : createXMLBasicProperty(doc, "text", "string", this.text),
				createXMLBasicProperty(doc, "frame", "bool", this.frame),
				createXMLBasicProperty(doc, "placeholderText", "string", this.placeholderText),
				createXMLBasicProperty(doc, "alignment", "set", this.getProp_alignment()),
				this.clearButtonEnabled === false ? null : createXMLBasicProperty(doc, "clearButtonEnabled", "bool", this.clearButtonEnabled),
				this.echoMode === "QLineEdit::Normal" ? null : createXMLBasicProperty(doc, "echoMode", "set", this.echoMode),
				this.cursorMoveStyle === "Qt::LogicalMoveStyle" ? null : createXMLBasicProperty(doc, "cursorMoveStyle", "set", this.cursorMoveStyle),
			];
		}
	}

	class QAbstractSpinBox extends QWidget {
		constructor() {
			super();
			this.element.classList.add("QAbstractSpinBox");

			this.contentElement = document.createElement("div");
			this.contentElement.classList.add("QAbstractSpinBox-content");
			this.buttonsElement = document.createElement("div");
			this.buttonsElement.classList.add("QAbstractSpinBox-buttons");
			this.buttonsTopElement = document.createElement("div");
			this.buttonsTopElement.classList.add("QAbstractSpinBox-buttons-top");
			this.buttonsBottomElement = document.createElement("div");
			this.buttonsBottomElement.classList.add("QAbstractSpinBox-buttons-bottom");


			this.buttonsElement.appendChild(this.buttonsTopElement);
			this.buttonsElement.appendChild(this.buttonsBottomElement);
			this.element.appendChild(this.contentElement);
			this.element.appendChild(this.buttonsElement);

			this.frame = true;
			this.alignmentHorizontal = "Qt::AlignLeft";
			this.alignmentVertical = "Qt::AlignVCenter";
			this.readOnly = false;

			this.addBasicPropGetterSetters(["frame", "alignmentHorizontal", "alignmentVertical", "readOnly"], this.updateDisplay);
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QAbstractSpinBox" },
				{ name: "frame", type: "bool", default: true, label: "Frame" },
				{ name: "alignmentHorizontal", type: "enum", default: "Qt::AlignLeft", label: "Alignment Horizontal", options: enumAlignmentHorizontal },
				{ name: "alignmentVertical", type: "enum", default: "Qt::AlignVCenter", label: "Alignment Vertical", options: enumAlignmentVertical },
				{ name: "readOnly", type: "bool", default: false, label: "Read Only" },
			];
		}

		updateDisplay() {
			this.contentElement.textContent = this.getDisplayValue();
			if (this.canGoUp() && !this.readOnly) {
				this.buttonsTopElement.classList.remove("QAbstractSpinBox-buttons-top-disabled");
			} else {
				this.buttonsTopElement.classList.add("QAbstractSpinBox-buttons-top-disabled");
			}
			if (this.canGoDown() && !this.readOnly) {
				this.buttonsBottomElement.classList.remove("QAbstractSpinBox-buttons-bottom-disabled");
			} else {
				this.buttonsBottomElement.classList.add("QAbstractSpinBox-buttons-bottom-disabled");
			}
	
			if (this.alignmentHorizontal == "Qt::AlignLeft" || this.alignmentHorizontal == "Qt::AlignJustify") {
				this.contentElement.style.justifyContent = "left";
				this.contentElement.style.textAlign = "left";
			} else if (this.alignmentHorizontal == "Qt::AlignHCenter") {
				this.contentElement.style.justifyContent = "center";
				this.contentElement.style.textAlign = "center";
			} else if (this.alignmentHorizontal == "Qt::AlignRight") {
				this.contentElement.style.justifyContent = "right";
				this.contentElement.style.textAlign = "right";
			}
			if (this.alignmentVertical == "Qt::AlignTop") {
				this.contentElement.style.alignItems = "start";
			} else if (this.alignmentVertical == "Qt::AlignVCenter" || this.alignmentVertical == "Qt::AlignBaseline") {
				this.contentElement.style.alignItems = "center";
			} else if (this.alignmentVertical == "Qt::AlignBottom") {
				this.contentElement.style.alignItems = "end";
			}

			if (this.frame) {
				this.element.classList.remove("QAbstractSpinBox-noframe");
			} else {
				this.element.classList.add("QAbstractSpinBox-noframe");
			}
		}

		getDisplayValue() {
			return "";
		}

		setProp_alignment(value) {
			for (const item of value.split("|")) {
				if (enumAlignmentHorizontal.find((x) => x.constant == item) != null) {
					this.alignmentHorizontal = item;
				} else if (enumAlignmentVertical.find((x) => x.constant == item) != null) {
					this.alignmentVertical = item;
				}
			}
			this.updateDisplay();
		}
		getProp_alignment() {
			return `${this.alignmentHorizontal}|${this.alignmentVertical}`;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			return [
				...props,
				this.frame == true ? null : createXMLBasicProperty(doc, "frame", "bool", this.frame),
				this.readOnly == false ? null : createXMLBasicProperty(doc, "readOnly", "bool", this.readOnly),
				createXMLBasicProperty(doc, "alignment", "set", this.getProp_alignment()),
			];
		}
	}

	class QSpinBox extends QAbstractSpinBox {
		constructor() {
			super();
			this.element.classList.add("QSpinBox");

			this.prefix = "";
			this.suffix = "";
			this.minimum = 0;
			this.maximum = 99;
			this.value = 0;
			this.displayIntegerBase = 10;

			this.addBasicPropGetterSetters(["prefix", "suffix", "minimum", "maximum", "value", "displayIntegerBase"], this.updateDisplay);

			this.updateDisplay();
		}

		getDefaultProps() {
			return [
				...super.getDefaultProps(),
				{ separator: "QSpinBox" },
				{ name: "prefix", type: "string", default: "", label: "Prefix" },
				{ name: "suffix", type: "string", default: "", label: "Suffix" },
				{ name: "minimum", type: "number", default: 0, label: "Minimum" },
				{ name: "maximum", type: "number", default: 99, label: "Maximum" },
				{ name: "value", type: "number", default: 0, label: "Value" },
				{ name: "singleStep", type: "number", default: 1, label: "Single Step" },
				{ name: "displayIntegerBase", type: "number", default: 10, label: "Display Integer Base" },
			];
		}

		getDisplayValue() {
			return this.prefix + this.value.toString(this.displayIntegerBase) + this.suffix;
		}

		canGoDown() {
			return this.value > this.minimum;
		}
		canGoUp() {
			return this.value < this.maximum;
		}

		exportProperties(doc) {
			const props = super.exportProperties(doc);
			return [
				...props,
				this.prefix === "" ? null : createXMLBasicProperty(doc, "prefix", "string", this.prefix),
				this.suffix === "" ? null : createXMLBasicProperty(doc, "suffix", "string", this.suffix),
				this.minimum === 0 ? null : createXMLBasicProperty(doc, "minimum", "number", this.minimum),
				this.maximum === 99 ? null : createXMLBasicProperty(doc, "maximum", "number", this.maximum),
				this.value === 0 ? null : createXMLBasicProperty(doc, "value", "number", this.value),
				this.displayIntegerBase === 10 ? null : createXMLBasicProperty(doc, "displayIntegerBase", "number", this.displayIntegerBase),
			];
		}
	}

	const elements = {
		QLayout,
		QBoxLayout,
		QVBoxLayout,
		QHBoxLayout,
		QWidget,
		QAbstractButton,
		QPushButton,
		QProgressBar,
		QFrame,
		QLabel,
		QLineEdit,
		QAbstractSpinBox,
		QSpinBox,
	};

	function addLayoutFromElement(/** @type {Element} */ raw, /** @type {QWidget} */ widget) {
		const className = raw.getAttribute("class");
		let layoutClass = elements[className];
		if (layoutClass === undefined) {
			layoutClass = QVBoxLayout;
			console.log("Unknown Qt layout class " + className);
			if (!widgetLoadErrors.includes(className)) {
				widgetLoadErrors.push(className);
			}
		}
	
		const childLayout = new layoutClass();
		if (raw.hasAttribute("name")) {
			childLayout.layoutName = raw.getAttribute("name");
		}
		widget.setLayout(childLayout);

		for (const child of raw.children) {
			if (child.tagName === "property") {
				const { name, value } = getDataFromXMLProperty(child);
				if (childLayout.propertyNameMapping[name] != null) {
					childLayout[childLayout.propertyNameMapping[name]] = value;
				}
			} else if (child.tagName === "item") {
				const childWidget = addWidgetFromElement(child.children[0]);
				widget.addChild(childWidget);
			}
		}
	}

	function addWidgetFromElement(/** @type {Element} */ raw) {
		if (raw.tagName !== "widget") {
			throw Error("Widget isn't a \"widget\" type");
		}
		const className = raw.getAttribute("class");
		let widgetClass = elements[className];
		if (widgetClass === undefined) {
			widgetClass = QWidget;
			console.log("Unknown Qt widget class " + className);
			if (!widgetLoadErrors.includes(className)) {
				widgetLoadErrors.push(className);
			}
		}
		/** @type {QWidget} */
		const widget = new widgetClass();
		widget.name = raw.getAttribute("name");

		for (const child of raw.children) {
			if (child.tagName === "property") {
				widget.setPropertyFromElement(child);
			} else if (child.tagName === "widget") {
				const childWidget = addWidgetFromElement(child);
				widget.addChild(childWidget);
			} else if (child.tagName === "layout") {
				addLayoutFromElement(child, widget);
			}
		}

		if (widgetLoadErrors.length == 0) {
			document.getElementById("warningWidgetLoadError").classList.remove("show");
		} else {
			document.getElementById("warningWidgetLoadError").classList.add("show");
			document.getElementById("warningWidgetLoadErrorWidgets").textContent = widgetLoadErrors.join(", ");
		}
		return widget;
	}

    function updateContent(/** @type {string} */ text) {
		if (text == "") {
			document.querySelector(".root").style.display = "none";
			document.querySelector(".new-file").style.display = null;
		} else {
			document.querySelector(".new-file").style.display = "none";
			document.querySelector(".root").style.display = null;
			loadExistingContent(text);
		}
	}
	function loadExistingContent(/** @type {string} */ text) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(text, "text/xml");
		const serializer = new XMLSerializer();
		const str = serializer.serializeToString(doc);

		if (lastXMLSerialized === str) {
			return;
		}

		widgetLoadErrors.length = 0;

		setCurrentSelection(null);
		const root = doc.getElementsByTagName("ui")[0];
		const rootWidgetRaw = root.querySelector("widget");
		if (rootWidget !== null) {
			rootWidget.free();
		}
		rootWidget = addWidgetFromElement(rootWidgetRaw);
		rootWidget.setAsRoot();
    }

	function save() {
		const doc = document.implementation.createDocument(null, "ui");
		doc.documentElement.setAttribute("version", "4.0");

		const classElement = doc.createElement("class");
		classElement.textContent = rootWidget.name;
		doc.documentElement.appendChild(classElement);
		
		doc.documentElement.appendChild(rootWidget.export(doc));

		const serializer = new XMLSerializer();
		const str = '<?xml version="1.0" encoding="UTF-8"?>' + serializer.serializeToString(doc);

		setContent(str);
	}

	function addToWidgetBox(widgetClass, label, icon, objectName, width, height, properties) {
		const item = document.createElement("div");
		const iconElement = document.createElement("img");
		const nameElement = document.createElement("span");
		item.classList.add("widget-box-item");
		iconElement.src = "https://raw.githubusercontent.com/qt/qttools/2a0a764b03559deda30f7b1795d72cbbe324ed83/src/designer/src/components/formeditor/images/" + icon;
		iconElement.width = "22";
		iconElement.height = "22";
		iconElement.draggable = false;
		nameElement.textContent = label;
		item.appendChild(iconElement);
		item.appendChild(nameElement);

		let overlay = null;
		let addPreview = null;

		function mouseDown(event) {
			event.preventDefault();
			window.addEventListener("mouseup", mouseUp);
			window.addEventListener("mousemove", mouseMove);
			addPreview = document.createElement("div");
			addPreview.classList.add("add-preview");
			addPreview.style.width = width + "px";
			addPreview.style.height = height + "px";
			document.body.appendChild(addPreview);
			overlay = document.createElement("div");
			overlay.classList.add("drag-overlay", "active");
			document.body.appendChild(overlay);
			mouseMove(event);
		}
		function mouseMove(event) {
			addPreview.style.left = event.clientX + "px";
			addPreview.style.top = event.clientY + "px";
		}
		function mouseUp(event) {
			event.preventDefault();
			window.removeEventListener("mouseup", mouseUp);
			window.removeEventListener("mousemove", mouseMove);
	
			addPreview.remove();
			overlay.remove();

			const mouseX = event.clientX;
			const mouseY = event.clientY;

			const rootX = rootWidget.element.getBoundingClientRect().x;
			const rootY = rootWidget.element.getBoundingClientRect().y;

			let widgetX = mouseX - rootX;
			let widgetY = mouseY - rootY;

			widgetX = Math.round(widgetX / 10) * 10;
			widgetY = Math.round(widgetY / 10) * 10;

			if (widgetX < 0 || widgetY < 0) {
				return;
			}

			let finalName = "";
			let number = 0;
			while (true) {
				finalName = objectName;
				if (number > 0) {
					finalName += "_" + number;
				}
				if (!getWidgetByName(finalName)) {
					break;
				}
				number += 1;
			}

			const widget = new widgetClass();
			widget.name = finalName;
			widget.setPosition(widgetX, widgetY);
			widget.setSize(width, height);
			if (properties != null) {
				for ([key, value] of Object.entries(properties)) {
					widget.setProperty(key, value);
				}
			}
			rootWidget.addChild(widget);
			setCurrentSelection(widget);
			save();
		}

		item.addEventListener("mousedown", mouseDown);

		document.getElementById("widgetBoxList").appendChild(item);
	}

	function loadWidgetBox() {
		addToWidgetBox(QWidget, "Widget", "widgets/widget.png", "widget", 120, 80);
		addToWidgetBox(QFrame, "Frame", "widgets/frame.png", "frame", 120, 80, {frameShape: "QFrame::StyledPanel", frameShadow: "QFrame::Raised"});
		addToWidgetBox(QLabel, "Label", "widgets/label.png", "label", 64, 16, {text: "TextLabel"});
		addToWidgetBox(QPushButton, "Push Button", "widgets/pushbutton.png", "pushButton", 80, 24, {text: "PushButton"});
		addToWidgetBox(QLineEdit, "Line Edit", "widgets/lineedit.png", "lineEdit", 113, 20);
		addToWidgetBox(QSpinBox, "Spin Box", "widgets/spinbox.png", "spinBox", 42, 22);
		addToWidgetBox(QProgressBar, "Progress Bar", "widgets/progress.png", "progressBar", 118, 23, {value: 24});
	}

	function setContent(text) {
		lastXMLSerialized = text;
		vscode.postMessage({ type: 'update', content: text, });
	}

    window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'update':
				const text = message.text;

				updateContent(text);

				vscode.setState({ text });

				return;
		}
	});

	for (const element of document.querySelectorAll(".view-title.collapsible")) {
		element.addEventListener("click", () => {
			element.parentElement.querySelector(".view-content").classList.toggle("view-content-hidden");
		});
	}

	document.querySelector(".side-collapsible").addEventListener("click", () => {
		document.querySelector(".sidebar-left").style.display = "none";
		document.querySelector(".side-collapsed-sidebar").style.display = null;
		updateSelectionPosition();
	});
	document.querySelector(".side-collapsed-sidebar").addEventListener("click", () => {
		document.querySelector(".sidebar-left").style.display = null;
		document.querySelector(".side-collapsed-sidebar").style.display = "none";
		updateSelectionPosition();
	});

	window.addEventListener("keydown", (event) => {
		if (event.target.tagName == "INPUT") {
			return;
		}
		if (currentSelection != null && !currentSelection.root) {
			if (event.key == "Delete") {
				currentSelection.free();
				save();
			}
			const amountChange = event.ctrlKey ? 1 : 10;
			if (event.shiftKey) {
				if (event.key == "ArrowUp") {
					const size = currentSelection.getSize();
					currentSelection.setSize(size.width, size.height - amountChange);
				} else if (event.key == "ArrowDown") {
					const size = currentSelection.getSize();
					currentSelection.setSize(size.width, size.height + amountChange);
				} else if (event.key == "ArrowRight") {
					const size = currentSelection.getSize();
					currentSelection.setSize(size.width + amountChange, size.height);
				} else if (event.key == "ArrowLeft") {
					const size = currentSelection.getSize();
					currentSelection.setSize(size.width - amountChange, size.height);
				}
			} else {
				if (event.key == "ArrowUp") {
					const position = currentSelection.getPosition();
					currentSelection.setPosition(position.x, position.y - amountChange);
				} else if (event.key == "ArrowDown") {
					const position = currentSelection.getPosition();
					currentSelection.setPosition(position.x, position.y + amountChange);
				} else if (event.key == "ArrowRight") {
					const position = currentSelection.getPosition();
					currentSelection.setPosition(position.x + amountChange, position.y);
				} else if (event.key == "ArrowLeft") {
					const position = currentSelection.getPosition();
					currentSelection.setPosition(position.x - amountChange, position.y);
				}
			}
		}
	});
	window.addEventListener("keyup", (event) => {
		if (event.target.tagName == "INPUT") {
			return;
		}
		if (currentSelection != null && !currentSelection.root) {
			if (event.key.startsWith("Arrow")) {
				save();
			}
		}
	});

	document.getElementById("newFileCreateButton").addEventListener("click", () => {
		document.querySelector(".new-file").style.display = "none";
		document.querySelector(".root").style.display = null;
		rootWidget = new QWidget();
		rootWidget.name = "Form";
		rootWidget.props.windowTitle = "Form";
		rootWidget.setPosition(0, 0);
		rootWidget.setSize(400, 300);
		rootWidget.setAsRoot();
		setCurrentSelection(rootWidget);
		save();
	});

	document.getElementById("reloadButton").addEventListener("click", () => {
		vscode.postMessage({type: 'reload'});
	});

	loadWidgetBox();

    const state = vscode.getState();
	if (state) {
		updateContent(state.text);
	} 
}());