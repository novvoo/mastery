/**
 * Redesigned ProjectTree — professional directory tree UI
 *
 * Design principles:
 * - Token-first: uses CSS variables from the app's theming system
 * - No emoji icons: all file/folder icons are clean SVGs from the design library
 * - Quiet hierarchy: subtle hover states, restrained borders, clear active state
 * - Type-led: size/weight/color carry the structure, not decoration
 */

import React, { useState, useCallback, useMemo } from 'react';
import { ContextMenu } from '../ui/ContextMenu.jsx';
import { InputDialog } from '../ui/InputDialog.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';

/* ── SVG Icon Components ────────────────────────────────────── */

const icons = {
  chevron: ({ expanded }) => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        transition: 'transform 0.15s ease',
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      }}
    >
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),

  folder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.375 10.6667V4.66666C1.375 3.21691 2.55026 2.04166 4 2.04166H5.95312C6.60779 2.04167 7.21883 2.36904 7.58203 2.91373L8.12402 3.72623L8.17773 3.79654C8.31129 3.95108 8.50671 4.04166 8.71387 4.04166H12C13.4498 4.04166 14.625 5.21692 14.625 6.66666V10.6667C14.625 12.1164 13.4498 13.2917 12 13.2917H4C2.55026 13.2917 1.375 12.1164 1.375 10.6667Z" />
    </svg>
  ),

  folderOpen: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.59668 2.04199C6.47419 2.04212 7.29349 2.4808 7.78027 3.21094L8.12402 3.72656L8.17773 3.79688C8.31128 3.9513 8.50679 4.04199 8.71387 4.04199H12C13.0815 4.04199 13.9578 4.9186 13.958 6V6.72559C14.7222 6.84204 15.2328 7.61867 14.9932 8.38574L13.8887 11.918C13.633 12.7353 12.8759 13.292 12.0195 13.292H2.96094C2.08537 13.292 1.37518 12.5815 1.375 11.7061V4.66699C1.375 3.21725 2.55026 2.04199 4 2.04199H5.59668ZM6.31445 7.95801C6.00474 7.95801 5.73019 8.15956 5.6377 8.45508L4.51758 12.042H12.0195C12.3293 12.042 12.6038 11.8405 12.6963 11.5449L13.7998 8.0127C13.8026 8.00365 13.8024 7.99724 13.8018 7.99316C13.8008 7.98811 13.7975 7.98173 13.793 7.97559C13.7884 7.96944 13.7829 7.9653 13.7783 7.96289C13.7746 7.961 13.7694 7.95898 13.7598 7.95898H13.333C13.3297 7.95898 13.3265 7.95806 13.3232 7.95801H6.31445Z" />
    </svg>
  ),

  file: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.11523 1.375C8.63434 1.37518 9.1329 1.58119 9.5 1.94824L12.7188 5.16797C13.0857 5.53519 13.292 6.03358 13.292 6.55273V12C13.292 13.4496 12.1165 14.6247 10.667 14.625H5.33398C3.88425 14.625 2.70801 13.4498 2.70801 12V4C2.70801 2.55026 3.88424 1.375 5.33398 1.375H8.11523Z" />
    </svg>
  ),

  js: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.3675 13.1844C9.49254 13.1844 8.20682 12.3741 7.83182 11.2491C7.78495 11.1018 7.75146 10.9411 7.75146 10.7804C7.75146 10.3451 8.01932 10.0638 8.4278 10.0638C8.76932 10.0638 8.9903 10.2179 9.13763 10.5795C9.43896 11.4835 10.3162 11.9054 11.4345 11.9054C12.6599 11.9054 13.5372 11.2759 13.5372 10.4121C13.5372 9.66205 13.0283 9.1933 11.7358 8.91205L10.6778 8.69107C8.74923 8.28259 7.872 7.38526 7.872 5.99241C7.872 4.33839 9.32513 3.2 11.3809 3.2C13.0483 3.2 14.3608 3.98348 14.7358 5.27589C14.7693 5.36964 14.7894 5.48348 14.7894 5.6241C14.7894 6.0125 14.5149 6.26696 14.1265 6.26696C13.7649 6.26696 13.5439 6.09955 13.3899 5.75134C13.0617 4.86071 12.3251 4.47901 11.3608 4.47901C10.2291 4.47901 9.39209 5.02812 9.39209 5.91205C9.39209 6.61518 9.89432 7.08393 11.1466 7.35178L12.1979 7.57277C14.2269 8.00134 15.0573 8.8116 15.0573 10.2179C15.0573 12.0393 13.6242 13.1844 11.3675 13.1844Z" />
      <path d="M3.81362 13.1844C2.49442 13.1844 1.44978 12.5348 1.05469 11.4835C0.967634 11.2424 0.914062 11.0482 0.914062 10.7804C0.914062 10.325 1.18862 10.0437 1.61719 10.0437C1.99888 10.0437 2.22656 10.2379 2.3471 10.6799C2.55469 11.4299 3.07031 11.8451 3.80022 11.8451C4.7846 11.8451 5.32031 11.2491 5.32031 10.1509V4.03036C5.32031 3.54821 5.60156 3.25357 6.07031 3.25357C6.53237 3.25357 6.82031 3.54821 6.82031 4.03036V10.1576C6.82031 12.0728 5.69531 13.1844 3.81362 13.1844Z" />
    </svg>
  ),

  ts: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.8343 13.1844C9.95933 13.1844 8.67362 12.3741 8.29862 11.2491C8.25174 11.1018 8.21826 10.9411 8.21826 10.7804C8.21826 10.3451 8.48612 10.0638 8.8946 10.0638C9.23612 10.0638 9.4571 10.2179 9.60442 10.5795C9.90576 11.4835 10.783 11.9054 11.9013 11.9054C13.1267 11.9054 14.004 11.2759 14.004 10.4121C14.004 9.66205 13.495 9.1933 12.2026 8.91205L11.1446 8.69107C9.21603 8.28259 8.3388 7.38526 8.3388 5.99241C8.3388 4.33839 9.79192 3.2 11.8477 3.2C13.5151 3.2 14.8276 3.98348 15.2026 5.27589C15.2361 5.36964 15.2562 5.48348 15.2562 5.6241C15.2562 6.0125 14.9817 6.26696 14.5933 6.26696C14.2317 6.26696 14.0107 6.09955 13.8567 5.75134C13.5285 4.86071 12.7919 4.47901 11.8276 4.47901C10.6959 4.47901 9.85889 5.02812 9.85889 5.91205C9.85889 6.61518 10.3611 7.08393 11.6134 7.35178L12.6647 7.57277C14.6937 8.00134 15.5241 8.8116 15.5241 10.2179C15.5241 12.0393 14.091 13.1844 11.8343 13.1844Z" />
      <path d="M4.15974 13.1308C3.69099 13.1308 3.40974 12.8362 3.40974 12.354V4.65982H1.0392C0.624023 4.65982 0.342773 4.40536 0.342773 4.01027C0.342773 3.61518 0.624023 3.36072 1.0392 3.36072H7.27358C7.68876 3.36072 7.97001 3.61518 7.97001 4.01027C7.97001 4.40536 7.68876 4.65982 7.27358 4.65982H4.90974V12.354C4.90974 12.8362 4.62179 13.1308 4.15974 13.1308Z" />
    </svg>
  ),

  html: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.8906 4.89096C11.1347 4.64688 11.5313 4.64688 11.7753 4.89096L13.9707 7.08627C14.475 7.59062 14.4748 8.40901 13.9707 8.91342L11.7753 11.1087C11.5313 11.3528 11.1347 11.3528 10.8906 11.1087C10.6468 10.8648 10.6469 10.469 10.8906 10.2249L13.0859 8.02963C13.1021 8.01339 13.1021 7.9873 13.0859 7.97104L10.8906 5.77572C10.6465 5.53165 10.6465 5.13504 10.8906 4.89096Z" />
      <path d="M4.22443 4.89096C4.46837 4.64708 4.86413 4.64734 5.10822 4.89096C5.3523 5.13504 5.3523 5.53165 5.10822 5.77573L2.91389 7.97104H2.91291C2.89717 7.98728 2.89696 8.01353 2.91291 8.02963H2.91389L5.10822 10.2249C5.3523 10.469 5.3523 10.8647 5.10822 11.1087C4.86412 11.3525 4.46842 11.3527 4.22443 11.1087L2.02912 8.91342C1.52485 8.409 1.52474 7.59063 2.02912 7.08627L4.22443 4.89096Z" />
    </svg>
  ),

  css: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.4111 2.04654C11.7535 2.08934 11.9967 2.40145 11.9541 2.74381L11.708 4.70865H13.334C13.679 4.70883 13.959 4.98858 13.959 5.33365C13.9588 5.67857 13.6789 5.95848 13.334 5.95865H11.5518L11.041 10.0417H13.334C13.679 10.0418 13.959 10.3216 13.959 10.6667C13.959 11.0117 13.679 11.2915 13.334 11.2917H10.8848L10.6201 13.4108C10.5773 13.7533 10.2653 13.9965 9.92285 13.9538C9.58034 13.911 9.33707 13.598 9.37988 13.2555L9.62598 11.2917H5.55176L5.28711 13.4108C5.24431 13.7532 4.9322 13.9963 4.58984 13.9538C4.24733 13.911 4.00406 13.598 4.04688 13.2555L4.29199 11.2917H2.66699C2.32181 11.2917 2.04199 11.0118 2.04199 10.6667C2.04199 10.3215 2.32181 10.0417 2.66699 10.0417H4.44824L4.95898 5.95865H2.66699C2.32192 5.95865 2.04217 5.67868 2.04199 5.33365C2.04199 4.98847 2.32181 4.70865 2.66699 4.70865H5.11523L5.37988 2.58951C5.4227 2.247 5.73561 2.00373 6.07812 2.04654C6.42038 2.08948 6.66273 2.40152 6.62012 2.74381L6.375 4.70865H10.4492L10.7139 2.58951C10.7567 2.24701 11.0686 2.00375 11.4111 2.04654Z" />
    </svg>
  ),

  json: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.66609 11.333V9.33299C2.66591 9.01082 2.43761 8.74205 2.13372 8.68008L1.86586 8.6533C1.56197 8.59133 1.33367 8.32255 1.3335 8.0004C1.3335 7.67805 1.56182 7.40835 1.86586 7.34638L2.13372 7.31959C2.4377 7.25757 2.66609 6.989 2.66609 6.66669V4.66669C2.66609 3.19393 3.86074 2.0004 5.3335 2.0004C5.70151 2.0006 5.99979 2.29863 5.99979 2.66669C5.99979 3.03476 5.70151 3.33278 5.3335 3.33299C4.59712 3.33299 3.99979 3.93031 3.99979 4.66669V6.66669C3.99979 7.17946 3.80478 7.64532 3.48751 7.99928C3.80515 8.35326 3.9997 8.81996 3.99979 9.33299V11.333C3.99979 12.0694 4.59711 12.6667 5.3335 12.6667C5.70139 12.6669 5.99959 12.9651 5.99979 13.333C5.99979 13.7011 5.70151 14.0002 5.3335 14.0004C3.86075 14.0004 2.66609 12.8058 2.66609 11.333Z" />
      <path d="M11.9998 11.333V9.33299C11.9999 8.82023 12.1936 8.35319 12.511 7.99928C12.194 7.64538 11.9998 7.17919 11.9998 6.66669V4.66669C11.9998 3.93031 11.4025 3.33299 10.6661 3.33299C10.2981 3.33279 9.99979 3.03476 9.99979 2.66669C9.99979 2.29863 10.2981 2.0006 10.6661 2.0004C12.1389 2.0004 13.3335 3.19394 13.3335 4.66669V6.66669C13.3335 6.98901 13.5619 7.25758 13.8659 7.31959L14.1337 7.34638C14.4378 7.40835 14.6661 7.67805 14.6661 8.0004C14.6659 8.32255 14.4376 8.59133 14.1337 8.6533L13.8659 8.68008C13.562 8.74205 13.3337 9.01081 13.3335 9.33299V11.333C13.3335 12.8058 12.1389 14.0004 10.6661 14.0004C10.2981 14.0002 9.99979 13.7011 9.99979 13.333C9.99999 12.9651 10.2982 12.6669 10.6661 12.6667C11.4025 12.6667 11.9998 12.0694 11.9998 11.333Z" />
    </svg>
  ),

  md: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.3896 5.33337C13.3896 4.56569 12.7677 3.94373 12 3.94373H4C3.23233 3.94373 2.61035 4.5657 2.61035 5.33337V10.6664C2.61035 11.4341 3.23232 12.057 4 12.057H12C12.7677 12.057 13.3896 11.4341 13.3896 10.6664V5.33337ZM14.6104 10.6664C14.6104 12.1079 13.4415 13.2767 12 13.2767H4C2.55855 13.2767 1.38965 12.1079 1.38965 10.6664V5.33337C1.38965 3.89191 2.55854 2.72302 4 2.72302H12C13.4415 2.72302 14.6104 3.89192 14.6104 5.33337V10.6664Z" />
      <path d="M10.0566 6.66663C10.0566 6.32973 10.3301 6.05627 10.667 6.05627C11.0039 6.05627 11.2773 6.32973 11.2773 6.66663V8.02991C11.5361 7.81541 11.9204 7.85078 12.1357 8.10901C12.3514 8.36776 12.3163 8.75268 12.0576 8.96838L11.0576 9.80237C10.8758 9.95378 10.6225 9.98574 10.4082 9.88538C10.1941 9.78499 10.0568 9.57012 10.0566 9.33362V6.66663Z" />
      <path d="M9.19803 8.10935C9.41371 7.85054 9.7986 7.81555 10.0574 8.03122L11.0574 8.86423C11.3162 9.07985 11.351 9.4648 11.1355 9.72361C10.9199 9.98241 10.535 10.0174 10.2762 9.80173L9.27616 8.96872C9.01735 8.75305 8.98236 8.36816 9.19803 8.10935Z" />
      <path d="M7.05664 9.33361V8.02501L6.57227 8.45568C6.34115 8.66112 5.99284 8.66112 5.76172 8.45568L5.27734 8.02501V9.33361C5.27717 9.67035 5.00378 9.94298 4.66699 9.94298C4.33021 9.94298 4.05682 9.67035 4.05664 9.33361V6.66661C4.05664 6.42641 4.19788 6.20838 4.41699 6.10997C4.6361 6.01158 4.89273 6.05102 5.07227 6.21056L6.16699 7.18322L7.26172 6.21056C7.44125 6.05102 7.69788 6.01158 7.91699 6.10997C8.13611 6.20838 8.27734 6.42641 8.27734 6.66661V9.33361C8.27717 9.67035 8.00378 9.94298 7.66699 9.94298C7.33021 9.94298 7.05682 9.67035 7.05664 9.33361Z" />
    </svg>
  ),

  py: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.62179 1.99771C10.1573 1.998 11.4054 3.20963 11.4722 4.72874C12.981 4.80859 14.1809 6.05503 14.1809 7.58365V8.50552L14.1653 8.79793C14.0196 10.2341 12.8115 11.3556 11.3394 11.366C11.4293 11.588 11.4801 11.8305 11.4801 12.0848C11.4799 13.1435 10.6214 14.0019 9.56264 14.0022H7.00237C5.48592 14.0019 4.24996 12.814 4.16755 11.318C2.83259 11.0758 1.81934 9.91023 1.81934 8.50552V7.58365L1.83496 7.29124C1.96934 5.96662 3.00724 4.91109 4.32268 4.74659C4.21776 4.50622 4.15975 4.24097 4.15974 3.962C4.15974 2.8774 5.03943 1.99771 6.12402 1.99771H8.62179Z" />
    </svg>
  ),

  go: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.21373 3.95188C4.88772 3.81334 5.60801 3.84952 6.27623 4.14608C6.94982 4.44507 7.52748 4.99015 7.93917 5.7934L6.87109 6.34027C6.57124 5.75535 6.1866 5.41948 5.78962 5.24318C5.38709 5.06453 4.92746 5.03025 4.45591 5.1271C3.48951 5.32575 2.58146 6.04895 2.22154 6.90277C1.75432 8.0113 1.82631 8.97813 2.16462 9.63938C2.49935 10.2936 3.10935 10.6907 3.85993 10.6907C5.54968 10.6905 6.49931 9.66911 6.88449 8.76103H4.35435V7.56014H7.8577C7.95007 7.08321 8.12189 6.61111 8.37556 6.1684C9.46891 4.2603 11.7952 3.37915 13.6244 4.42733C15.4534 5.47557 15.8694 7.92782 14.7762 9.83581C13.6829 11.7439 11.3566 12.6251 9.52734 11.5769C8.67985 11.0913 8.13582 10.304 7.90457 9.40947C7.31606 10.6329 6.02433 11.8903 3.85993 11.8905C2.63593 11.8905 1.62582 11.2205 1.09654 10.1863C0.570926 9.1589 0.534242 7.81518 1.11551 6.43626C1.64008 5.19186 2.88884 4.22428 4.21373 3.95188Z" />
    </svg>
  ),

  vue: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.80313 10.7302C7.8915 10.8805 8.10878 10.8805 8.19715 10.7302L13.031 2.51268C13.072 2.44286 13.147 2.39999 13.228 2.39999H14.4495C14.6254 2.39999 14.7354 2.59029 14.6476 2.74267L8.29722 13.7649C8.16532 13.9939 7.83496 13.9939 7.70306 13.7649L1.3527 2.74267C1.26491 2.59029 1.37489 2.39999 1.55076 2.39999H2.77231C2.85331 2.39999 2.92826 2.44286 2.96932 2.51268L7.80313 10.7302Z" />
      <path d="M7.80475 4.79585C7.89182 4.9482 8.11099 4.94967 8.2001 4.7985L9.54766 2.51249C9.58876 2.44278 9.66365 2.39999 9.74457 2.39999H11.1887C11.3654 2.39999 11.4753 2.59209 11.3857 2.74446L8.29565 7.997C8.16308 8.22234 7.8372 8.22234 7.70463 7.997L4.61462 2.74446C4.52498 2.59209 4.63484 2.39999 4.81163 2.39999H6.30278C6.38479 2.39999 6.46052 2.44394 6.50122 2.51514L7.80475 4.79585Z" />
    </svg>
  ),

  yaml: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.66113 11.4688C8.41852 11.4688 9.03223 12.0834 9.03223 12.8408C9.03201 13.598 8.41839 14.2119 7.66113 14.2119C6.90385 14.2119 6.29025 13.5981 6.29004 12.8408C6.29004 12.0834 6.90372 11.4688 7.66113 11.4688ZM9.58301 1.5C9.7212 1.50001 9.82778 1.6218 9.80957 1.75879L8.71191 10.0146C8.69667 10.1281 8.59983 10.2129 8.48535 10.2129H7.18164C7.04973 10.2129 6.94477 10.1014 6.95312 9.96973L7.48047 1.71387C7.48821 1.59359 7.58844 1.5 7.70898 1.5H9.58301Z" />
    </svg>
  ),

  refresh: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8C2 4.68629 4.68629 2 8 2C10.419 2 12.511 3.32886 13.5584 5.29999" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 8C14 11.3137 11.3137 14 8 14C5.58104 14 3.48904 12.6711 2.44165 10.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2V5.29999H10.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 14V10.7H5.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  newFile: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 1.33325H4.66667C3.19391 1.33325 2 2.52716 2 3.99992V11.9999C2 13.4727 3.19391 14.6666 4.66667 14.6666H11.3333C12.8061 14.6666 14 13.4727 14 11.9999V5.33325L10 1.33325Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 1.33325V5.33325H14" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 7.99992V11.9999" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 9.99992H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),

  newFolder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.3335 10.6666V4.66659C1.3335 3.19383 2.52741 1.99992 4.00016 1.99992H5.95328C6.60795 1.99992 7.21899 2.32729 7.58219 2.87198L8.12418 3.68448L8.17789 3.7548C8.31145 3.90934 8.50687 3.99992 8.71403 3.99992H12.0002C13.4729 3.99992 14.6668 5.19383 14.6668 6.66659V10.6666C14.6668 12.1393 13.4729 13.3333 12.0002 13.3333H4.00016C2.52741 13.3333 1.3335 12.1393 1.3335 10.6666Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8.66659V11.3333" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6.6665 9.99992H9.33317" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),

  rename: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.3335 1.66667C11.6872 1.31299 12.1685 1.08679 12.6668 1.08679C12.9151 1.08679 13.1603 1.1368 13.3864 1.23335C13.6125 1.3299 13.8147 1.4708 13.9806 1.64603C14.1465 1.82127 14.2725 2.0268 14.3511 2.25029C14.4296 2.47379 14.4585 2.71037 14.4355 2.94465C14.4125 3.17893 14.3382 3.40505 14.2201 3.60745C14.1021 3.80986 13.9439 3.98362 13.7605 4.11667C13.5771 4.24972 13.3728 4.33856 13.1607 4.37609C12.9487 4.41363 12.7348 4.39883 12.5299 4.33333L11.3335 1.66667ZM11.3335 1.66667L7.3335 5.66667C6.66683 6.33333 6.3335 6.66667 6.00016 7.33333L5.3335 9.33333L7.3335 8.66667C8.00016 8.33333 8.3335 8 9.00016 7.33333L13.0002 3.33333L11.3335 1.66667Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11.3333V12.6667C14 13.0203 13.8595 13.3594 13.6095 13.6095C13.3595 13.8595 13.0203 14 12.6667 14H3.33333C2.97971 14 2.64057 13.8595 2.39052 13.6095C2.14048 13.3594 2 13.0203 2 12.6667V3.33333C2 2.97971 2.14048 2.64057 2.39052 2.39052C2.64057 2.14048 2.97971 2 3.33333 2H4.66667" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  delete: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.3335 4.00008V2.66675C5.3335 2.31313 5.47397 1.97399 5.72402 1.72394C5.97407 1.47389 6.31321 1.33341 6.66683 1.33341H9.3335C9.68712 1.33341 10.0263 1.47389 10.2763 1.72394C10.5264 1.97399 10.6668 2.31313 10.6668 2.66675V4.00008" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.6668 4V13.3333C12.6668 13.687 12.5264 14.0261 12.2763 14.2761C12.0263 14.5262 11.6872 14.6667 11.3335 14.6667H4.66683C4.31321 14.6667 3.97407 14.5262 3.72402 14.2761C3.47397 14.0261 3.3335 13.687 3.3335 13.3333V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  search: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7.33333" cy="7.33333" r="4.66667" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 14L10.6667 10.6667" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  folderEmpty: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 19C22 20.1 21.1 21 20 21H4C2.9 21 2 20.1 2 19V5C2 3.9 2.9 3 4 3H9L11 6H20C21.1 6 22 6.9 22 8V19Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),

  fileSearch: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.5 15.5L19 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  spinner: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="animate-spin">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.2" />
      <path d="M8 2C4.68629 2 2 4.68629 2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  loadingDir: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.15" />
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" strokeDasharray="40" strokeDashoffset="20" strokeLinecap="round" />
    </svg>
  ),
};

/* ── File-type → Icon mapping ────────────────────────────── */

const FILE_ICON_MAP = {
  js: icons.js,
  jsx: icons.js,
  mjs: icons.js,
  cjs: icons.js,
  ts: icons.ts,
  tsx: icons.ts,
  dts: icons.ts,
  html: icons.html,
  htm: icons.html,
  css: icons.css,
  scss: icons.css,
  less: icons.css,
  json: icons.json,
  md: icons.md,
  mdx: icons.md,
  py: icons.py,
  pyc: icons.py,
  go: icons.go,
  vue: icons.vue,
  svelte: icons.vue,
  yaml: icons.yaml,
  yml: icons.yaml,
  toml: icons.yaml,
};

/* ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */

const INDENT_SIZE = 20;

/* ── TreeNode sub-component ──────────────────────────────── */

function TreeNode({
  entry,
  depth = 0,
  isExpanded = false,
  isLoading = false,
  isActiveFile = false,
  hasChildren = false,
  onToggle,
  onOpen,
  onContextMenu,
  filteredCount = 0,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isDirectory = entry.type === 'directory';

  const ext =
    !isDirectory && entry.name?.includes('.')
      ? entry.name.split('.').pop().toLowerCase()
      : '';

  const fileIcon = isDirectory
    ? isExpanded
      ? icons.folderOpen
      : icons.folder
    : FILE_ICON_MAP[ext] || icons.file;

  const handleClick = useCallback(() => {
    if (isDirectory) {
      onToggle?.(entry.path);
    } else {
      onOpen?.(entry);
    }
  }, [entry, isDirectory, onToggle, onOpen]);

  return (
    <div
      role="treeitem"
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-selected={isActiveFile}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-xs, 4px)',
        height: '28px',
        paddingLeft: depth > 0 ? `${8 + depth * INDENT_SIZE}px` : '8px',
        paddingRight: '8px',
        borderRadius: 'var(--radius-sm, 4px)',
        cursor: 'pointer',
        fontSize: 'var(--font-size-sm, 12px)',
        color: isActiveFile
          ? 'var(--primary-color)'
          : 'var(--text-color)',
        transition: 'background-color 0.12s ease, color 0.12s ease',
        backgroundColor: isActiveFile
          ? 'var(--primary-faint)'
          : isHovered
          ? 'var(--surface-hover)'
          : 'transparent',
        userSelect: 'none',
        ...(isLoading ? { opacity: 0.55 } : {}),
      }}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu?.(e, entry)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={entry.path}
    >
      {/* ── Active file accent bar ── */}
      {isActiveFile && (
        <div
          style={{
            position: 'absolute',
            left: '0',
            top: '4px',
            bottom: '4px',
            width: '2px',
            borderRadius: '1px',
            backgroundColor: 'var(--primary-color)',
          }}
        />
      )}

      {/* ── Toggle chevron (directories only) ── */}
      <span
        style={{
          width: '16px',
          height: '16px',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isDirectory
            ? isExpanded
              ? 'var(--text-color)'
              : 'var(--text-muted)'
            : 'transparent',
          transition: 'color 0.12s ease',
        }}
      >
        {isDirectory ? (
          <icons.chevron expanded={isExpanded} />
        ) : null}
      </span>

      {/* ── File/folder icon ── */}
      <span
        style={{
          width: '16px',
          height: '16px',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isActiveFile
            ? 'var(--primary-color)'
            : isDirectory
            ? isExpanded
              ? 'var(--text-color)'
              : 'var(--text-muted)'
            : 'var(--text-muted)',
        }}
      >
        {fileIcon}
      </span>

      {/* ── Name ── */}
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          fontWeight: isActiveFile ? 500 : 400,
          lineHeight: '1.4',
        }}
      >
        {entry.name}
      </span>

      {/* ── Filtered match count ── */}
      {isDirectory && filteredCount > 0 && (
        <span
          style={{
            flexShrink: 0,
            marginLeft: 'auto',
            padding: '0 5px',
            height: '16px',
            minWidth: '16px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-full, 999px)',
            backgroundColor: 'var(--primary-soft)',
            color: 'var(--primary-color)',
            fontSize: '10px',
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {filteredCount}
        </span>
      )}

      {/* ── Loading indicator ── */}
      {isLoading && (
        <span style={{ flexShrink: 0, display: 'inline-flex' }}>
          {icons.spinner}
        </span>
      )}
    </div>
  );
}

/* ── Main ProjectTree component ───────────────────────────── */

export function ProjectTree({ projectTree, workingDirectory, onOpenFile, activeOpenFile }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Right-click menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }

  // Dialog state
  const [dialog, setDialog] = useState(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState(null);

  const {
    directoryChildren = {},
    expandedDirectories = new Set(),
    loadingDirectories = new Set(),
    status = 'idle',
    error = '',
    onToggleDirectory,
    onRefresh,
    onCreateFile,
    onCreateDirectory,
    onDeleteItem,
    onRenameItem,
  } = projectTree || {};

  // Compute relative path
  const getRelativePath = useCallback((fullPath) => {
    if (!workingDirectory) return fullPath;
    return fullPath.replace(workingDirectory + '/', '').replace(workingDirectory + '\\', '');
  }, [workingDirectory]);

  // Get parent directory path
  const getParentPath = useCallback((fullPath) => {
    const parts = fullPath.split(/[\\/]/);
    parts.pop();
    return parts.join('/');
  }, []);

  // ── Context menu handlers ──

  const handleContextMenu = useCallback((e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleCreateFile = useCallback((parentPath = '') => {
    setContextMenu(null);
    setDialog({ type: 'createFile', parentPath });
  }, []);

  const handleCreateDirectory = useCallback((parentPath = '') => {
    setContextMenu(null);
    setDialog({ type: 'createDir', parentPath });
  }, []);

  const handleRename = useCallback((entry) => {
    setContextMenu(null);
    setDialog({ type: 'rename', entry });
  }, []);

  const handleDelete = useCallback((entry) => {
    setContextMenu(null);
    setConfirmDialog({
      title: '确认删除',
      message: `确定要删除 ${entry.type === 'directory' ? '目录' : '文件'} "${entry.name}" 吗？此操作不可撤销。`,
      danger: true,
      onConfirm: async () => {
        const result = await onDeleteItem?.(entry.path);
        if (result?.success) {
          onRefresh?.();
        }
      },
    });
  }, [onDeleteItem, onRefresh]);

  // ── Dialog confirm ──

  const handleDialogConfirm = useCallback(async (value) => {
    const { type, parentPath, entry } = dialog;

    if (type === 'createFile') {
      const targetPath = parentPath ? `${parentPath}/${value}` : value;
      const result = await onCreateFile?.(targetPath);
      if (result?.success) {
        onRefresh?.();
        const newEntry = { path: result.path, name: value, type: 'file' };
        onOpenFile?.(newEntry);
      }
    } else if (type === 'createDir') {
      const targetPath = parentPath ? `${parentPath}/${value}` : value;
      const result = await onCreateDirectory?.(targetPath);
      if (result?.success) {
        onRefresh?.();
      }
    } else if (type === 'rename') {
      const parent = getParentPath(entry.path);
      const newPath = parent ? `${parent}/${value}` : value;
      const result = await onRenameItem?.(entry.path, newPath);
      if (result?.success) {
        onRefresh?.();
      }
    }

    setDialog(null);
  }, [dialog, onCreateFile, onCreateDirectory, onRenameItem, onRefresh, onOpenFile, getParentPath]);

  // ── Context menu items ──

  const contextMenuItems = useMemo(() => {
    if (!contextMenu?.entry) return [];

    const { entry } = contextMenu;
    const isDirectory = entry.type === 'directory';
    const baseItems = [
      {
        id: 'rename',
        label: '重命名',
        icon: icons.rename,
        onClick: () => handleRename(entry),
      },
      {
        id: 'delete',
        label: '删除',
        icon: icons.delete,
        danger: true,
        onClick: () => handleDelete(entry),
      },
    ];

    if (isDirectory) {
      return [
        {
          id: 'newFile',
          label: '新建文件',
          icon: icons.newFile,
          onClick: () => handleCreateFile(entry.path),
        },
        {
          id: 'newFolder',
          label: '新建子目录',
          icon: icons.newFolder,
          onClick: () => handleCreateDirectory(entry.path),
        },
        { type: 'divider' },
        ...baseItems,
      ];
    }

    return baseItems;
  }, [contextMenu, handleRename, handleDelete, handleCreateFile, handleCreateDirectory]);

  const blankContextMenuItems = useMemo(() => [
    {
      id: 'newFile',
      label: '新建文件',
      icon: icons.newFile,
      onClick: () => handleCreateFile(''),
    },
    {
      id: 'newFolder',
      label: '新建目录',
      icon: icons.newFolder,
      onClick: () => handleCreateDirectory(''),
    },
  ], [handleCreateFile, handleCreateDirectory]);

  // ── Root name ──

  const rootName = useMemo(() => {
    if (!workingDirectory) return '未设置';
    const parts = workingDirectory.split(/[\\/]/).filter(Boolean);
    return parts.pop() || workingDirectory;
  }, [workingDirectory]);

  // ── Filtering ──

  const filterEntries = useCallback((entries, query) => {
    if (!query) return entries;
    const lowerQuery = query.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase().includes(lowerQuery));
  }, []);

  const countFilteredChildren = useCallback((path, query) => {
    if (!query) return 0;
    const entries = directoryChildren[path] || [];
    let count = 0;
    for (const entry of entries) {
      if (entry.type === 'directory') {
        count += countFilteredChildren(entry.path, query);
      } else if (entry.name.toLowerCase().includes(query.toLowerCase())) {
        count += 1;
      }
    }
    return count;
  }, [directoryChildren]);

  // ── Tree renderer ──

  const renderTree = useCallback(
    (parentPath = '', depth = 0) => {
      const entries = directoryChildren[parentPath] || [];
      const isLoading = loadingDirectories.has(parentPath);
      const filteredEntries = searchQuery ? filterEntries(entries, searchQuery) : entries;

      if (isLoading && entries.length === 0) {
        return (
          <div style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px`, paddingRight: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-xs, 4px)',
                height: '28px',
                color: 'var(--text-muted)',
                fontSize: 'var(--font-size-sm, 12px)',
                opacity: 0.55,
              }}
            >
              <span style={{ width: '16px', flexShrink: 0 }} />
              <span style={{ width: '16px', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {icons.folder}
              </span>
              <span>读取中...</span>
              <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                {icons.spinner}
              </span>
            </div>
          </div>
        );
      }

      const shouldFilter = searchQuery && filteredEntries.length !== entries.length;

      if (!shouldFilter && filteredEntries.length === 0) {
        return null;
      }

      const displayEntries = shouldFilter
        ? entries.filter((entry) => {
            if (entry.name.toLowerCase().includes(searchQuery.toLowerCase())) return true;
            if (entry.type === 'directory') return countFilteredChildren(entry.path, searchQuery) > 0;
            return false;
          })
        : filteredEntries;

      if (displayEntries.length === 0) return null;

      return (
        <React.Fragment>
          {displayEntries.map((entry) => {
            const isDirectory = entry.type === 'directory';
            const hasChildren = directoryChildren[entry.path]?.length > 0 || loadingDirectories.has(entry.path);
            const isExpanded = expandedDirectories.has(entry.path) || (shouldFilter && hasChildren);
            const isLoading = loadingDirectories.has(entry.path);
            const isActiveFile = !isDirectory && activeOpenFile?.path === entry.path;
            const filteredCount = searchQuery && isDirectory ? countFilteredChildren(entry.path, searchQuery) : 0;

            return (
              <React.Fragment key={entry.path}>
                <TreeNode
                  entry={entry}
                  depth={depth}
                  isExpanded={isExpanded}
                  isLoading={isLoading}
                  isActiveFile={isActiveFile}
                  hasChildren={hasChildren}
                  onToggle={onToggleDirectory}
                  onOpen={onOpenFile}
                  onContextMenu={handleContextMenu}
                  filteredCount={filteredCount}
                />
                {isDirectory && isExpanded && renderTree(entry.path, depth + 1)}
              </React.Fragment>
            );
          })}
        </React.Fragment>
      );
    },
    [
      directoryChildren,
      expandedDirectories,
      loadingDirectories,
      searchQuery,
      activeOpenFile,
      onToggleDirectory,
      onOpenFile,
      handleContextMenu,
      filterEntries,
      countFilteredChildren,
    ],
  );

  const hasAnyEntries = Object.keys(directoryChildren).length > 0;

  // ── Render ──

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-sm, 8px)',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 'var(--font-size-xs, 11px)',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
          title={workingDirectory || ''}
        >
          {rootName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!workingDirectory || status === 'loading'}
            title="刷新文件列表"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: 'var(--radius-sm, 4px)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-xs, 11px)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.12s ease, color 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
              e.currentTarget.style.color = 'var(--text-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            {icons.refresh}
          </button>
        </div>
      </div>

      {/* ── Search ── */}
      <div
        style={{
          padding: '5px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-xs, 4px)',
            height: '26px',
            padding: '0 8px',
            borderRadius: 'var(--radius-sm, 4px)',
            backgroundColor: 'var(--surface-input)',
            border: '1px solid',
            borderColor: searchFocused ? 'var(--primary-color)' : 'transparent',
            transition: 'border-color 0.15s ease, background-color 0.15s ease',
          }}
        >
          <span
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              color: 'var(--text-muted)',
            }}
          >
            {icons.search}
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="搜索文件..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-color)',
              fontSize: 'var(--font-size-sm, 12px)',
              lineHeight: '1.4',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* ── Tree area ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '3px 4px',
        }}
        onContextMenu={(e) => {
          const treeRow = e.target.closest('[role="treeitem"]');
          if (treeRow) return;
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, entry: null });
        }}
      >
        {/* Error state */}
        {error ? (
          <div
            style={{
              margin: '4px 4px',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm, 4px)',
              fontSize: 'var(--font-size-sm, 12px)',
              color: 'var(--error-color)',
              backgroundColor: 'var(--error-faint)',
              border: '1px solid var(--error-soft)',
            }}
          >
            {error}
          </div>
        ) : status === 'loading' && !hasAnyEntries ? (
          /* Loading state */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--spacing-sm, 8px)',
              padding: '24px 16px',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm, 12px)',
            }}
          >
            <span style={{ opacity: 0.4 }}>{icons.loadingDir}</span>
            <span>正在读取项目文件...</span>
          </div>
        ) : directoryChildren[''] && directoryChildren[''].length === 0 ? (
          /* Empty state */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--spacing-sm, 8px)',
              padding: '24px 16px',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm, 12px)',
            }}
          >
            <span style={{ opacity: 0.3 }}>{icons.folderEmpty}</span>
            <span>工作目录为空</span>
          </div>
        ) : searchQuery && !renderTree('', 0) ? (
          /* No search results */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--spacing-sm, 8px)',
              padding: '24px 16px',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm, 12px)',
            }}
          >
            <span style={{ opacity: 0.3 }}>{icons.fileSearch}</span>
            <span>未找到匹配的文件</span>
          </div>
        ) : (
          <div role="tree">{renderTree('', 0)}</div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.entry ? contextMenuItems : blankContextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ── Input Dialog ── */}
      {dialog && (
        <InputDialog
          title={
            dialog.type === 'createFile'
              ? '新建文件'
              : dialog.type === 'createDir'
              ? '新建目录'
              : '重命名'
          }
          label={
            dialog.type === 'createFile'
              ? '文件名'
              : dialog.type === 'createDir'
              ? '目录名'
              : '新名称'
          }
          placeholder={
            dialog.type === 'createFile'
              ? '例如: index.js'
              : dialog.type === 'createDir'
              ? '例如: src'
              : '输入新名称'
          }
          defaultValue={dialog.type === 'rename' ? dialog.entry?.name || '' : ''}
          onConfirm={handleDialogConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* ── Confirm Dialog ── */}
      {confirmDialog && (
        <ConfirmDialog
          isOpen
          title={confirmDialog.title}
          message={confirmDialog.message}
          danger={confirmDialog.danger}
          onConfirm={() => {
            confirmDialog.onConfirm?.();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

export default ProjectTree;
