/**
 * binary-parser.js
 * Handles parsing of binary replay files for Civilization V
 * Uses jDataView library to read binary data with proper byte order handling
 */

/**
 * BinaryParser constructor
 * @param {ArrayBuffer} file - The binary file to parse
 * @param {number} size - Size of the file in bytes
 */
var BinaryParser = function (file, size) {
	this.view = new jDataView(file, 0, size, false)

	return this
}

BinaryParser.prototype.parseItem = function (itemConfig, includeJunk) {
	if (typeof itemConfig === 'string') {
		itemConfig = { type: itemConfig }
	}

	if (typeof itemConfig == 'function') {
		(itemConfig.bind(this))()
	}

	switch (itemConfig.type) {
		case 'byte': return this.getBytes(itemConfig.length)
		case 'str': return this.getString(itemConfig.length)
		case 'varstr': return this.getVarString()
		case 'int32': return this.getInt32()
		case 'int16': return this.getInt16()
		case 'int8': return this.getInt8()
		case 'until': return this.getUntil(itemConfig.value)
		case 'tell': return this.tell()
		case 'array': return this.getArray(itemConfig.items, includeJunk)

		default:
			break
	}
}

BinaryParser.prototype.parseItems = function (itemConfigs, includeJunk) {
	if (itemConfigs.type == 'array') {
		return this.parseItem(itemConfigs, includeJunk)
	}

	// Takes dictionary of configs
	var data = {}

	_.each(itemConfigs, (type, key) => {
		var pointer = this.tell();

		try {
			var value = this.parseItem(type, includeJunk)

			if (key == "events") console.log(`Parsed ${value.length} events`);

			// Bail if we don't want to include junk data
			if (key.startsWith('_') && includeJunk === false) { return }

			data[key] = value
		} catch (e) {
			// Seek back to the pointer
			this.view.seek(pointer);
			console.error(`Error parsing key "${key}" at position ${this.decToHex(pointer)}: ${e}`);
			// Print the next 200 bytes
			console.log(`Next 200 bytes: ${this.getBytes(200).toHex().toUpperCase()}`);
			// Print the current data
			console.log(data);
			throw (e);
		}
	})

	// console.log(data);
	return data
}

BinaryParser.prototype.tell = function () {
	return this.view.tell()
}

BinaryParser.prototype.getBytes = function (length) {
	try {
		return this.view.getBytes(length)
	} catch (e) {
		throw new Error(`Unable to read ${length} bytes at position ${this.decToHex(this.tell())}`)
	}
}

BinaryParser.prototype.getString = function (length) {
	try {
		return this.view.getString(length)
	} catch (e) {
		throw new Error(`Unable to read string of length ${length} at position ${this.decToHex(this.tell())}`)
	}
}

BinaryParser.prototype.getInt32 = function () {
	return this.view.getInt32(this.tell(), true)
}

BinaryParser.prototype.getInt16 = function () {
	return this.view.getInt16(this.tell(), true)
}

BinaryParser.prototype.getInt8 = function () {
	return this.view.getInt8(this.tell(), true)
}

BinaryParser.prototype.getUntil = function (test) {
	var result = []
	var val = null

	do {
		val = this.getInt8()
		result.push(val)
	} while (val != test)

	return result
}

BinaryParser.prototype.getVarString = function () {
	// Variable-length string - uses first four bytes to specify length
	var length = this.getInt32()
	var value = this.getString(length)
	return value
}

BinaryParser.prototype.getArray = function (config, includeJunk) {
	var length = this.getInt32()
	var records = []

	for (var i = 0; i < length; i++) {
		var record = {}

		if (typeof config == 'function') {
			record = config(i, includeJunk)
		}
		else if (typeof config == 'object') {
			record = this.parseItems(config, includeJunk)
		}

		records.push(record)
	}

	return records
}

BinaryParser.prototype.decToHex = function (dec) {
	// arbitrary length decimal to hex conversion
	return parseInt(dec).toString(16).toUpperCase().padStart(2, '0');
}