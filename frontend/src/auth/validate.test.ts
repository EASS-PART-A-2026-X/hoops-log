import { describe, expect, it } from 'vitest'
import { checkConfirm, checkEmail, checkPassword, checkUsername, passwordStrength } from './validate'

describe('checkEmail', () => {
  it.each(['a@b.co', 'yuly@example.com', "o'brien@example.org", ' padded@example.com '])('accepts %s', (v) => {
    expect(checkEmail(v)).toBeNull()
  })
  it.each(['', '   ', 'yuly', 'yuly@', '@example.com', 'a@b', 'a b@example.com', 'a@@example.com'])('refuses %j', (v) => {
    expect(checkEmail(v)).not.toBeNull()
  })
  it('asks for it when empty and explains when wrong', () => {
    expect(checkEmail('')).toBe('Enter your email.')
    expect(checkEmail('nope')).toBe('That does not look like an email address.')
  })
  it('stops at 254 characters', () => {
    expect(checkEmail('x'.repeat(242) + '@example.com')).toBeNull() // 254
    expect(checkEmail('x'.repeat(243) + '@example.com')).not.toBeNull() // 255
  })
})

describe('checkUsername', () => {
  it.each(['abc', 'a_b.c-d', 'x'.repeat(30), '  yuly  '])('accepts %j', (v) => {
    expect(checkUsername(v)).toBeNull()
  })
  it.each(['', '  ', 'ab', 'x'.repeat(31), 'a b', 'yuly!', 'יולי', 'a/b'])('refuses %j', (v) => {
    expect(checkUsername(v)).not.toBeNull()
  })
  it('has a message for empty and one for wrong', () => {
    expect(checkUsername('')).toBe('Pick a username.')
    expect(checkUsername('a b')).toMatch(/3 to 30/)
  })
})

describe('checkPassword', () => {
  it('needs 10 characters and says how many there are', () => {
    expect(checkPassword('')).toBe('Enter a password.')
    expect(checkPassword('123456789')).toBe('Use at least 10 characters (9 so far).')
    expect(checkPassword('x'.repeat(10))).toBeNull()
  })
  it('stops at 128', () => {
    expect(checkPassword('x'.repeat(128))).toBeNull()
    expect(checkPassword('x'.repeat(129))).toBe('Use at most 128 characters.')
  })
  it('does not trim: spaces count', () => {
    expect(checkPassword(' '.repeat(10))).toBeNull()
  })
  it('refuses the username and the name in the email, in any case', () => {
    expect(checkPassword('yulyyulyyuly', 'YulyYulyYuly', '')).toMatch(/username or your email/)
    expect(checkPassword('myname1234', 'other', 'MyName1234@example.com')).toMatch(/username or your email/)
    expect(checkPassword('myname1234', 'other', 'x@example.com')).toBeNull()
    expect(checkPassword('myname1234x', 'myname1234', '')).toBeNull() // only an exact match
  })
})

describe('checkConfirm', () => {
  it('asks, compares, and accepts a match', () => {
    expect(checkConfirm('secret-secret', '')).toBe('Type the password again.')
    expect(checkConfirm('secret-secret', 'secret-secreT')).toBe('The two passwords do not match.')
    expect(checkConfirm('secret-secret', 'secret-secret')).toBeNull()
  })
})

describe('passwordStrength', () => {
  it.each([
    ['', 0, ''],
    ['short', 1, 'TOO SHORT'],
    ['abcdefghij', 1, 'WEAK'], // 10 characters, one kind
    ['abcdefghijklm', 1, 'WEAK'],
    ['abcdefghijklmn', 2, 'OK'], // 14 characters
    ['Abcdefghij', 2, 'OK'], // two kinds
    ['Abcdefghij1', 2, 'OK'], // three kinds but only 11 long
    ['Abcdefghij12', 3, 'GOOD'], // three kinds, 12 long
    ['Abcdefghijklm1', 4, 'STRONG'], // 14 long and three kinds
  ])('%j is %i bars (%s)', (value, bars, label) => {
    expect(passwordStrength(value)).toEqual({ bars, label })
  })
})
