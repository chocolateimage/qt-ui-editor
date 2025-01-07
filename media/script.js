(function () {
	const vscode = acquireVsCodeApi();

	let currentSelection = null;
	let rootWidget = null;
	let lastXMLSerialized = null;

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

	class QWidget {
		constructor() {
			this.element = document.createElement("div");
			this.parent = null;
			this.children = [];
			this._name = "";
			this.root = false;
			this.props = {};
		
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
			this.inspectorElement.appendChild(this.inspectorElementLabel);
			this.inspectorElement.appendChild(this.inspectorElementContainer);

			this._propertyEditorProperties = {};
		}

		getDefaultProps() {
			return [
				{ separator: "QWidget" },
				{name: "name", type: "string", label: "Name"},
				...(this.root ? [
					{name: "windowTitle", type: "string", default: "", label: "Window Title"}
				] : [
					{name: "x", type: "number", default: 0, label: "X"},
					{name: "y", type: "number", default: 0, label: "Y"},
				]),
				{name: "width", type: "number", default: 100, label: "Width"},
				{name: "height", type: "number", default: 100, label: "Height"},
			];
		}

		get name() {
			return this._name;
		}

		set name(newValue) {
			this._name = newValue;
			this.inspectorElementLabel.textContent = this._name;
			this.invalidateProperty("name");
		}

		free() {
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
				selectionDot.addEventListener("mousedown", this.selectionMouseDown.bind(this, selectionDot, change));
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

			const defaultProps = this.getDefaultProps();
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
						this.setProperty(defaultProp.name, newValue);
						save();
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
			propertyEditorItem.input.value = this.getProperty(name);

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
		/******************/

		setProp_geometry(value) {
			this.setPosition(value.x, value.y);
			this.setSize(value.width, value.height);
		}

		setPropertyFromElement(/** @type {Element} */ element) {
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
			} else {
				value = valueRaw.textContent;
			}

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
				return this.getDefaultProps().find((x) => x.name === name).default;
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
		}

		createXMLBasicProperty(doc, name, type, value) {
			const property = doc.createElement("property");
			property.setAttribute("name", name);
			const propertyValue = doc.createElement(type);
			propertyValue.textContent = value;
			property.appendChild(propertyValue);
			return property;
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
			for (const child of this.children) {
				element.appendChild(child.export(doc));
			}
			return element;
		}

		exportProperties(/** @type{XMLDocument} */ doc) {
			const properties = [];
			for (const [key, value] of Object.entries(this.props)) {
				const property = doc.createElement("property");
				property.setAttribute("name", key);
				const propertyValue = doc.createElement(typeof value);
				propertyValue.textContent = value.toString();
				property.appendChild(propertyValue);
				properties.push(property);
			}
			{
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
			}
			return properties;
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
				this.createXMLBasicProperty(doc, "value", "number", this.value),
				this.minimum === 0 ? null : this.createXMLBasicProperty(doc, "minimum", "number", this.minimum),
				this.maximum === 100 ? null : this.createXMLBasicProperty(doc, "maximum", "number", this.maximum),
				this.format === "%p%" ? null : this.createXMLBasicProperty(doc, "format", "string", this.format),
			];
		}
	}

	const elements = {
		QWidget,
		QAbstractButton,
		QPushButton,
		QProgressBar
	};

	function addWidgetFromElement(/** @type {Element} */ raw) {
		if (raw.tagName !== "widget") {
			throw Error("Widget isn't a \"widget\" type");
		}
		const className = raw.getAttribute("class");
		let widgetClass = elements[className];
		if (widgetClass === undefined) {
			widgetClass = QWidget;
			console.log("Unknown Qt widget class " + className);
		}
		const widget = new widgetClass();
		widget.name = raw.getAttribute("name");

		for (const child of raw.children) {
			if (child.tagName === "property") {
				widget.setPropertyFromElement(child);
			} else if (child.tagName === "widget") {
				const childWidget = addWidgetFromElement(child);
				widget.addChild(childWidget);
			}
		}
		return widget;
	}

    function updateContent(/** @type {string} */ text) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(text, "text/xml");
		const serializer = new XMLSerializer();
		const str = serializer.serializeToString(doc);

		if (lastXMLSerialized === str) {
			return;
		}

		setCurrentSelection(null);
		const root = doc.getElementsByTagName("ui")[0];
		const rootWidgetRaw = root.querySelector("widget");
		if (rootWidget !== null) {
			rootWidget.free();
		}
		rootWidget = addWidgetFromElement(rootWidgetRaw);
		rootWidget.root = true;
		document.querySelector(".main").replaceChildren(rootWidget.element);
		document.getElementById("objectInspectorRoot").appendChild(rootWidget.inspectorElement);
		rootWidget.recalculate();
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

	for (const element of document.getElementsByClassName("view-title")) {
		element.addEventListener("click", () => {
			element.parentElement.querySelector(".view-content").classList.toggle("view-content-hidden");
		});
	}

    const state = vscode.getState();
	if (state) {
		updateContent(state.text);
	} 
}());